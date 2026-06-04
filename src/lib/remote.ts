import type { AnimationSlot, LottiePlayer } from "@/lib/lottie-player";

/**
 * A stable, global remote-control surface for the player, exposed on
 * `window.lottie`. It exists so an automated agent driving the browser (e.g.
 * via a devtools/console bridge) can control playback and seek to exact frames
 * deterministically, instead of pixel-dragging the on-screen slider. It is
 * invisible — it adds no UI — and mirrors the controls a human has.
 *
 * Everything is in *frames* unless the method name says otherwise. Seeking
 * pauses playback first so the rendered frame holds still for inspection;
 * call `play()` to resume.
 */
export interface LottieRemote {
  play(): void;
  pause(): void;
  toggle(): void;
  /** Pauses, then jumps to an absolute frame (clamped). Returns the frame landed on. */
  seek(frame: number): number;
  /** Pauses, then steps by `frames` (default 1, negative to go back). Returns the new frame. */
  step(frames?: number): number;
  /** Pauses, then seeks to a time in seconds. Returns the frame landed on. */
  seekToTime(seconds: number): number;
  /** Pauses, then seeks to normalized progress 0..1. Returns the frame landed on. */
  seekToProgress(t: number): number;
  /** A snapshot of playback state. The cheapest way for an agent to read where things are. */
  getState(): {
    playing: boolean;
    currentFrame: number;
    totalFrames: number;
    fps: number;
    durationSeconds: number;
    progress: number;
    zoom: number;
  };
  /** Lists every slottable (live-editable) property with its current value. */
  getSlots(): AnimationSlot[];
  /**
   * Overrides a slottable property live. `value` must match the slot's type:
   * scalar → number, color → [r,g,b,a] (0..1), vec2 → [x,y], text → string.
   */
  setSlot(id: string, value: AnimationSlot["value"]): void;
  resetCamera(): void;
}

declare global {
  interface Window {
    lottie?: LottieRemote;
  }
}

/** Installs (or replaces) `window.lottie` so it drives the given player. */
export function installRemote(player: LottiePlayer): void {
  const seek = (frame: number): number => {
    player.pause();
    player.seek(frame);
    return player.getCurrentFrame();
  };

  window.lottie = {
    play: () => player.play(),
    pause: () => player.pause(),
    toggle: () => player.toggle(),
    seek,
    step: (frames = 1) => seek(player.getCurrentFrame() + frames),
    seekToTime: (seconds) => seek(seconds * player.getFps()),
    seekToProgress: (t) => seek(t * player.getTotalFrames()),
    getState: () => {
      const totalFrames = player.getTotalFrames();
      const fps = player.getFps();
      const currentFrame = player.getCurrentFrame();
      return {
        playing: player.isPlaying(),
        currentFrame,
        totalFrames,
        fps,
        durationSeconds: totalFrames / fps,
        progress: totalFrames > 0 ? currentFrame / totalFrames : 0,
        zoom: player.getZoom(),
      };
    },
    getSlots: () => player.getSlots(),
    setSlot: (id, value) => {
      const slot = player.getSlots().find((s) => s.id === id);
      if (!slot) throw new Error(`No slot with id "${id}"`);
      switch (slot.type) {
        case "scalar":
          player.setScalarSlot(id, value as number);
          break;
        case "color":
          player.setColorSlot(id, value as [number, number, number, number]);
          break;
        case "vec2":
          player.setVec2Slot(id, value as [number, number]);
          break;
        case "text":
          player.setTextSlot(id, value as string);
          break;
      }
    },
    resetCamera: () => player.resetCamera(),
  };
}

/** Removes `window.lottie` (e.g. when the player is torn down). */
export function removeRemote(): void {
  delete window.lottie;
}
