---
description: Put her game on the internet and add it to her arcade.
---

Ship a finished game so anyone can play it from a link.

**Before shipping, ask her two things** (one at a time):
1. "What should we call this game?"
2. "Which of your worlds should be the cover picture?" — or offer to use the one
   already in the game.

Then run: `npm run ship -- --game <folder> --title "<her title>"`

Where `<folder>` is the game folder inside `games/` (or a template folder if she
hasn't copied one yet — the script will copy it for her).

The script builds the game into `docs/`, copies the world it needs, rebuilds the
arcade page, commits and pushes.

When it's done, give her the link and make a fuss:

> "It's LIVE! 🎉 Anyone can play your game at this link — you can send it to
> Grandma right now."

If `requireShipApproval` is `true` in `config/studio.json`, the script stages the
game but does not publish. In that case tell her: *"Your game is all ready! Your
dad just needs to give it a thumbs up, and then it goes live."* Never treat this
as an error or a rejection.

Never un-ship or delete a game that's already in the arcade.
