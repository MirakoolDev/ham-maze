// Assets carried over from the Unity project (HAM): concrete maps, fonts, logo, paper, music.
// Bundled as data URLs so the game stays a single self-contained file.
import concreteAlbedo from '../assets/concrete_albedo.jpg';
import concreteNormal from '../assets/concrete_normal.jpg';
import concreteRough from '../assets/concrete_roughness.jpg';
import breadIsland from '../assets/bread-island.otf';
import cabinet from '../assets/cabinet-grotesk.otf';
import logo from '../assets/logo.png';
import paper from '../assets/paper.jpg';
import music from '../assets/music.mp3';

export const urls = { concreteAlbedo, concreteNormal, concreteRough, logo, paper, music };

/** Register the HAM fonts and expose images to CSS as custom properties. */
export function installUiAssets() {
  for (const [family, src] of [['Bread Island', breadIsland], ['Cabinet Grotesk', cabinet]]) {
    try { const f = new FontFace(family, `url(${src})`); document.fonts.add(f); f.load().catch(() => {}); } catch { /* old browser: falls back */ }
  }
  const r = document.documentElement.style;
  r.setProperty('--logo', `url(${logo})`);
  r.setProperty('--paper', `url(${paper})`);
  r.setProperty('--concrete', `url(${concreteAlbedo})`);
}
