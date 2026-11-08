import './style.css';
import { mountMenus } from '../ui/menus';

// A bare URL opens the menus; any query string starts a match straight away (D-091). The menus
// build that query string, and each match is its own page load.
if (location.search === '') mountMenus(document.getElementById('frame')!);
else void import('./match');
