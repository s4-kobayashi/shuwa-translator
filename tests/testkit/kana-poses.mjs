// Synthetic poses for every static kana, written independently from the
// classifier's prototypes: these follow the joint-level description of each
// handshape (docs/vocabulary.md) using the hand model's presets.
import { F } from "./handmodel.mjs";

const { E, C, H, B, K, W, P } = F;
const U = [5, -5, -4, -9]; // index & middle together
const V = [9, -6, -4, -9];
const SPREAD = [10, 0, -8, -16];

export const KANA_POSES = {
  あ: { fingers: [C, C, C, C], thumb: "side" },
  い: { fingers: [C, C, C, E], thumb: "across" },
  う: { fingers: [E, E, C, C], abd: U, thumb: "across" },
  え: { fingers: [W, W, W, W], thumb: "tuck" },
  お: { fingers: [H, H, H, H], thumb: { touch: 8 } },
  か: { fingers: [E, [32, 0, 0], C, C], abd: V, thumb: { touch: 10 } },
  き: { fingers: [E, P, P, E], abd: [6, 0, -4, -14], thumb: { touch: 12 } },
  く: { fingers: [E, E, E, E], abd: SPREAD, thumb: "out", orient: "side" },
  け: { fingers: [E, E, E, E], abd: [2, 0, -2, -4], thumb: "tuck" },
  こ: {
    fingers: [B, B, B, B],
    abd: [2, 0, -2, -4],
    thumb: "tuck",
    orient: "profile",
  },
  さ: { fingers: [C, C, C, C], thumb: "across" },
  し: { fingers: [E, E, C, C], abd: V, thumb: "out", orient: "side" },
  す: { fingers: [E, E, C, C], abd: V, thumb: "out", orient: "down" },
  せ: { fingers: [C, E, C, C], thumb: "across" },
  そ: { fingers: [E, C, C, C], thumb: "across", orient: "fwdDown" },
  た: { fingers: [C, C, C, C], thumb: "up" },
  ち: { fingers: [P, P, P, E], abd: [0, 0, 0, -12], thumb: { touch: 8 } },
  つ: { fingers: [P, P, E, E], abd: [0, 0, -6, -14], thumb: { touch: 8 } },
  て: { fingers: [E, E, E, E], abd: [2, 0, -2, -4], thumb: "out" },
  と: { fingers: [E, E, C, C], abd: U, thumb: "across", orient: "upSigner" },
  な: { fingers: [E, E, C, C], abd: U, thumb: "across", orient: "down" },
  に: { fingers: [E, E, C, C], abd: U, thumb: "across", orient: "side" },
  ぬ: { fingers: [K, C, C, C], thumb: "across" },
  ね: { fingers: [E, E, E, E], abd: SPREAD, thumb: "out", orient: "down" },
  は: { fingers: [E, E, C, C], abd: U, thumb: "across", orient: "fwd" },
  ひ: { fingers: [E, C, C, C], thumb: "across" },
  ふ: { fingers: [E, C, C, C], thumb: "out", orient: "down" },
  へ: { fingers: [C, C, C, E], thumb: "out", orient: "down" },
  ほ: {
    fingers: [B, B, B, B],
    abd: [2, 0, -2, -4],
    thumb: "tuck",
    orient: "upSigner",
  },
  ま: {
    fingers: [E, E, E, C],
    abd: [5, 0, -5, -9],
    thumb: { touch: 20 },
    orient: "downSigner",
  },
  み: {
    fingers: [E, E, E, C],
    abd: [5, 0, -5, -9],
    thumb: { touch: 20 },
    orient: "side",
  },
  む: { fingers: [E, C, C, C], thumb: "out", orient: "side" },
  め: { fingers: [P, E, E, E], abd: [0, 2, -4, -10], thumb: { touch: 8 } },
  や: { fingers: [C, C, C, E], abd: [4, 0, -4, -14], thumb: "out" },
  ゆ: {
    fingers: [E, E, E, C],
    abd: [5, 0, -5, -9],
    thumb: { touch: 20 },
    orient: "upSigner",
  },
  よ: {
    fingers: [E, E, E, E],
    abd: [2, 0, -2, -4],
    thumb: "tuck",
    orient: "side",
  },
  ら: { fingers: [E, E, C, C], abd: [-14, 6, -4, -9], thumb: "across" },
  る: { fingers: [E, E, C, C], abd: V, thumb: "out" },
  れ: { fingers: [E, C, C, C], thumb: "out" },
  ろ: { fingers: [K, K, C, C], abd: U, thumb: "across" },
  わ: { fingers: [E, E, E, C], abd: [5, 0, -5, -9], thumb: { touch: 20 } },
};
