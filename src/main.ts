import "./styles/hud.css";
import { GameEngine } from "./game/GameEngine";
import { HudController } from "./ui/HudController";

const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
let hud: HudController;

const engine = new GameEngine(canvas, (snap) => {
  if (hud) hud.render(snap);
});

hud = new HudController(engine);
engine.setScreen("hub");
engine.start();
