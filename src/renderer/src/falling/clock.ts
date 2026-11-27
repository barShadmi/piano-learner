// The song clock: tells the view which second of the song it is now.
// Pure TypeScript. The time source can be replaced in tests.

export interface SongClockOptions {
  /** Real time in milliseconds. Defaults to performance.now(). */
  now?: () => number
}

export class SongClock {
  private readonly now: () => number
  private playing = false
  private rate = 1
  /** Song position in seconds when the clock was last anchored. */
  private anchorSong = 0
  /** Real time in milliseconds when the clock was last anchored. */
  private anchorReal = 0

  constructor(options: SongClockOptions = {}) {
    this.now = options.now ?? (() => performance.now())
  }

  /** 1 = normal speed. 0.5 = half speed. */
  get speed(): number {
    return this.rate
  }

  get isPlaying(): boolean {
    return this.playing
  }

  /** The song position in seconds right now. */
  nowSeconds(): number {
    if (!this.playing) return this.anchorSong
    return this.anchorSong + ((this.now() - this.anchorReal) / 1000) * this.rate
  }

  /** Start (or keep) playing. With a speed, the position is kept and the new speed is used. */
  play(speed?: number): void {
    if (speed !== undefined) {
      this.reanchor()
      this.rate = speed
    }
    if (this.playing) return
    this.anchorReal = this.now()
    this.playing = true
  }

  /** Stop at the current position. */
  pause(): void {
    if (!this.playing) return
    this.anchorSong = this.nowSeconds()
    this.playing = false
  }

  /** Move to a position in seconds. Keeps playing if it was playing. */
  seek(seconds: number): void {
    this.anchorSong = seconds
    this.anchorReal = this.now()
  }

  // Store the current position so a speed change does not jump.
  private reanchor(): void {
    if (this.playing) {
      this.anchorSong = this.nowSeconds()
      this.anchorReal = this.now()
    }
  }
}
