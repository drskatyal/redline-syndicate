import "./styles/hud.css";

const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;

async function bootstrap() {
  if (window.location.search.includes("studio=1")) {
    const uiRoot = document.getElementById("uiRoot");
    if (uiRoot) uiRoot.style.display = "none";
    const loadOverlay = document.getElementById("loadingOverlay");
    if (loadOverlay) loadOverlay.style.display = "none";
    const { startAssetStudio } = await import("./studio/AssetStudio");
    await startAssetStudio(canvas);
    return;
  }

  const [{ GameEngine }, { HudController }] = await Promise.all([
    import("./game/GameEngine"),
    import("./ui/HudController"),
  ]);

  let hud: InstanceType<typeof HudController>;
  const engine = new GameEngine(canvas, (snap) => {
    if (hud) hud.render(snap);
  });
  hud = new HudController(engine);
  await engine.init();
  engine.setScreen("hub");
  engine.start();
}

bootstrap().catch((err) => {
  console.error("Bootstrap error:", err);
});
