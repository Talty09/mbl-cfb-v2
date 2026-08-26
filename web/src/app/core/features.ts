/**
 * Temporary UI kill switches. Nothing here removes behavior from the API or the
 * client — a flag only decides what the shell advertises.
 */

/**
 * The Draft Room tab. Off until the league is ready to draft; the route, the
 * page, the pulse polling and every `/api/draft` endpoint stay wired up, so
 * flipping this back to `true` is the whole re-enable. While it is off the page
 * is still reachable at /draft-room directly, which is how it gets tested.
 */
export const DRAFT_ROOM_ENABLED = false;
