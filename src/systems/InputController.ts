export interface ControlIntent {
  throttle: boolean;
  brake: boolean;
  steer: number; // -1 left .. +1 right
  nitro: boolean;
  bulletTime: boolean;
  strikeLeftPressed: boolean;
  strikeRightPressed: boolean;
  strikeAutoPressed: boolean;
  kickPressed: boolean;
  empPressed: boolean;
  cameraPressed: boolean;
  pausePressed: boolean;
  radioPressed: boolean;
}

export class InputController {
  private keys = new Set<string>();
  private oneShot = {
    strikeLeft: false,
    strikeRight: false,
    strikeAuto: false,
    kick: false,
    emp: false,
    camera: false,
    pause: false,
    radio: false,
  };
  private touchState = {
    throttle: false,
    brake: false,
    left: false,
    right: false,
    nitro: false,
    bulletTime: false,
  };
  private botOverride: Partial<ControlIntent> | null = null;
  private focusToggle = false;

  constructor(onFirstGesture?: () => void) {
    const fireGesture = () => onFirstGesture && onFirstGesture();

    window.addEventListener("keydown", (e) => {
      fireGesture();
      const code = e.code;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(code)) {
        e.preventDefault();
      }
      if (!e.repeat) {
        if (code === "KeyQ" || code === "KeyZ") this.oneShot.strikeLeft = true;
        if (code === "KeyE" || code === "KeyX") this.oneShot.strikeRight = true;
        if (code === "Space" || code === "Numpad0") this.oneShot.strikeAuto = true;
        if (code === "KeyC" || code === "KeyK") this.oneShot.kick = true;
        if (code === "KeyF") this.oneShot.emp = true;
        if (code === "KeyV") this.oneShot.camera = true;
        if (code === "KeyM") this.oneShot.radio = true;
        if (code === "Escape" || code === "KeyP") this.oneShot.pause = true;
        if (code === "Tab" || code === "KeyR") this.focusToggle = !this.focusToggle;
      }
      this.keys.add(code);
    });

    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });

    const clearAll = () => {
      this.keys.clear();
      this.focusToggle = false;
      this.touchState.throttle = false;
      this.touchState.brake = false;
      this.touchState.left = false;
      this.touchState.right = false;
      this.touchState.nitro = false;
      this.touchState.bulletTime = false;
    };
    window.addEventListener("blur", clearAll);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) clearAll();
    });
  }

  public bindTouchButton(
    el: HTMLElement | null,
    action: "throttle" | "brake" | "left" | "right" | "nitro" | "bulletTime" | "strike" | "kick" | "emp",
    onFirstGesture?: () => void
  ): void {
    if (!el) return;
    const isHold =
      action === "throttle" ||
      action === "brake" ||
      action === "left" ||
      action === "right" ||
      action === "nitro" ||
      action === "bulletTime";

    const press = (e: PointerEvent) => {
      e.preventDefault();
      if (onFirstGesture) onFirstGesture();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // ignore capture issues
      }
      el.classList.add("active");
      if (isHold) {
        this.touchState[action] = true;
      } else if (action === "strike") {
        this.oneShot.strikeAuto = true;
      } else if (action === "kick") {
        this.oneShot.kick = true;
      } else if (action === "emp") {
        this.oneShot.emp = true;
      }
    };

    const release = () => {
      el.classList.remove("active");
      if (isHold) {
        this.touchState[action] = false;
      }
    };

    el.addEventListener("pointerdown", press);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", release);
  }

  public setBotIntent(intent: Partial<ControlIntent> | null): void {
    this.botOverride = intent;
  }

  public clearFocus(): void {
    this.focusToggle = false;
  }

  public sample(): ControlIntent {
    const left = this.keys.has("ArrowLeft") || this.keys.has("KeyA") || this.touchState.left;
    const right = this.keys.has("ArrowRight") || this.keys.has("KeyD") || this.touchState.right;
    const steer = (left ? -1 : 0) + (right ? 1 : 0);

    const intent: ControlIntent = {
      throttle: this.keys.has("ArrowUp") || this.keys.has("KeyW") || this.touchState.throttle,
      brake: this.keys.has("ArrowDown") || this.keys.has("KeyS") || this.touchState.brake,
      steer,
      nitro: this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.touchState.nitro,
      bulletTime: this.focusToggle || this.touchState.bulletTime,
      strikeLeftPressed: this.oneShot.strikeLeft,
      strikeRightPressed: this.oneShot.strikeRight,
      strikeAutoPressed: this.oneShot.strikeAuto,
      kickPressed: this.oneShot.kick,
      empPressed: this.oneShot.emp,
      cameraPressed: this.oneShot.camera,
      pausePressed: this.oneShot.pause,
      radioPressed: this.oneShot.radio,
    };

    this.oneShot.strikeLeft = false;
    this.oneShot.strikeRight = false;
    this.oneShot.strikeAuto = false;
    this.oneShot.kick = false;
    this.oneShot.emp = false;
    this.oneShot.camera = false;
    this.oneShot.pause = false;
    this.oneShot.radio = false;

    if (this.botOverride) {
      return { ...intent, ...this.botOverride };
    }
    return intent;
  }
}
