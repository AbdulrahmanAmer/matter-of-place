/* =====================================================================
   The film: which world, which camera
   ===================================================================== */
function update(t) {
  t = clamp(t, 0, DUR);
  if (!WORLD.G.printed) snapPrint();
  let w;
  if (t < T_S2) { applyHall(t); hallCam(t); w = WORLD.H; }
  else if (t < T_CA) { applyGallery(t); galleryCam(t); w = WORLD.G; }
  else if (t < T_NY) { applyMarket('CA', t); w = WORLD.CA; }
  else if (t < T_FL) { applyMarket('NY', t); w = WORLD.NY; }
  else if (t < T_PK) { applyMarket('FL', t); w = WORLD.FL; }
  else if (t < T_WL) { applyPackages(t); w = WORLD.PK; }
  else if (t < T_LK) { applyWall(t); w = WORLD.WL; }
  else { applyHall(t); hallCam(t); w = WORLD.H; }
  ACTIVE = w;
  applyCam();
}

