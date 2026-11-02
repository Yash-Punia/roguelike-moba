import { Team } from './sim';

/**
 * The team a unit is drawn as for the local player (GDD §10): your team is always Blue and the
 * enemy Red, whichever side you actually play. Neutral stays neutral. Render and UI only; the
 * sim keeps true teams (D-039).
 */
export function displayTeam(team: Team, local: Team): Team {
  if (team === Team.Neutral) return team;
  return team === local ? Team.Blue : Team.Red;
}
