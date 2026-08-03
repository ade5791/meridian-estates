// v2 rules 2-3: black-frame watchdog + frame-error containment +
// single automatic quality step-down from a rolling 120-sample fps window.

export class Resilience {
  constructor(renderer, onForceDirect, onStepDown) {
    this.renderer = renderer;
    this.onForceDirect = onForceDirect;
    this.onStepDown = onStepDown;
    this.blackReads = 0;
    this.checksDone = 0;
    this.checkTimes = [1500, 3000]; // ms after first frame
    this.firstFrameAt = null;
    this.forcedDirect = false;
    this.frameErrors = 0;
    this.lastErrorMsg = null;
    this.postDropped = false;
    this.fpsSamples = [];
    this.steppedDown = false;
    this._px = new Uint8Array(8 * 8 * 4);
  }

  // call once per rendered frame with delta ms
  frame(dtMs) {
    const now = performance.now();
    if (this.firstFrameAt === null) this.firstFrameAt = now;

    // black-frame watchdog
    if (!this.forcedDirect && this.checksDone < this.checkTimes.length &&
        now - this.firstFrameAt >= this.checkTimes[this.checksDone]) {
      this.checksDone++;
      if (this.readCenterIsBlack()) {
        this.blackReads++;
        if (this.blackReads >= 2) {
          this.forcedDirect = true;
          try { this.onForceDirect(); } catch (e) { /* keep playing */ }
        }
      }
    }

    // rolling fps window, exactly ONE automatic step-down
    if (!this.steppedDown && dtMs > 0) {
      this.fpsSamples.push(1000 / dtMs);
      if (this.fpsSamples.length > 120) this.fpsSamples.shift();
      if (this.fpsSamples.length === 120) {
        const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / 120;
        if (avg < 45) {
          this.steppedDown = true;
          try { this.onStepDown(); } catch (e) { /* keep playing */ }
        }
      }
    }
  }

  readCenterIsBlack() {
    try {
      const gl = this.renderer.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const x = Math.max(0, (w >> 1) - 4), y = Math.max(0, (h >> 1) - 4);
      gl.readPixels(x, y, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, this._px);
      for (let i = 0; i < this._px.length; i += 4) {
        if (this._px[i] > 8 || this._px[i + 1] > 8 || this._px[i + 2] > 8) return false;
      }
      return true;
    } catch (e) {
      return false; // cannot read -> do not punish
    }
  }

  // returns true if the error budget says: drop post/shadows
  reportFrameError(err) {
    const msg = String(err && err.message || err);
    if (msg === this.lastErrorMsg) this.frameErrors++;
    else { this.lastErrorMsg = msg; this.frameErrors = 1; }
    if (this.frameErrors >= 3 && !this.postDropped) {
      this.postDropped = true;
      return true;
    }
    return false;
  }
}
