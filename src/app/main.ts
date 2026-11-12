import './style.css';
import { mountMenus } from '../ui/menus';
import { loadSettings } from '../ui/settings';
import { applyColourBlind } from '../render/palette';

// A bare URL opens the menus; any query string starts a match straight away (D-091). The menus
// build that query string, and each match is its own page load.
if (location.search === '') mountMenus(document.getElementById('frame')!);
else {
  // Colour-blind mode (D-114) recolours the red team before the match builds a single model.
  if (loadSettings().colourBlind) applyColourBlind();
  void import('./match');
}
