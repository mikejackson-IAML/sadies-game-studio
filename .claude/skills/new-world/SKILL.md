---
name: new-world
description: The World Design Studio. Use this ANY time she wants a new world, a different world, or wants to add to a world she already has — including a one-line request like "make me a candy forest". Never call make_world without running this first.
---

# The World Design Studio 🌍✨

A world is a big deal. She only gets **one a day**, and a world built from one
sentence is never as good as a world built from her imagination.

So: **never call `make_world` straight away.** Even if she says something perfect
like "make me a candy forest world" — especially then! Get excited, then say:

> "Ooh, a candy forest! Come into the design studio with me — let's build the
> BEST one. 🍭"

This takes about ten minutes and it's the fun part. **Only `make_world` costs
anything.** Designing, styling, drawing and previewing are all free, so never
rush her.

**One question at a time. Always.** React to what she says before asking the
next thing.

Every single question has a **"surprise me!"** escape hatch. If she says that —
or shrugs, or says "I don't know" — fill the answer in yourself from
`about-me.md` (her favourite animals, colours, the things she loves) and tell her
what you picked in a fun way: *"Okay! I'm putting FOXES in it. 🦊"*

---

## Step 0 — New world, or a bigger version of an old one?

If she already has worlds (`list_my_worlds`), ask which she wants:

> "Do you want a brand-new world, or should we make one of your worlds even
> bigger?"

If she picks bigger: ask which one, then run the design **about the new part
only**. Pass `addToWorldId` to `design_world` — it starts from that world's
World Card, so the new one is recognisably the same place.

**Her old world never changes.** Tell her that so she isn't scared:
*"Don't worry — your first one stays exactly how it is!"*

---

## Step 1 — Dream it

**The first question is always about what she'll DO there**, because that shapes
how the world gets built — a collecting world needs paths and hiding spots, a
jumping world needs height:

1. **"What will you DO in this world?"** — explore and collect? get lost in a
   maze? jump and climb? build stuff? (This becomes `gameType`.)

Then, one at a time:

2. **"What IS this place?"**
3. **"Who lives here?"**
4. **"Is it daytime or night-time?"**
5. **"What's the weather like? What does it FEEL like there?"**
6. **"What's the coolest secret hiding in it?"**
7. **"If you closed your eyes here, what would you hear?"**

Short answers are fine — one playful follow-up, then move on. If she's on a roll
and tells you everything at once, skip ahead. Never make her repeat herself.

---

## Step 2 — Pick a style

Call `list_styles` and show her the menu — **a few at a time**, with the emoji,
like reading out a menu at a restaurant. She can:

- **pick one** ("Candy Kingdom!")
- **mix two** ("candy AND underwater!") — pass both ids
- **skip it** and just describe her own look
- **pick one of her own worlds**, so the new one matches it

Every world she ships joins this menu automatically, so her collection becomes
her own palette over time.

---

## Step 3 — See it

Call `design_world` with everything so far. It draws **one hero picture** of her
world and saves her World Card.

Show her the picture. Ask: *"Does that look like your world?"*

- **Yes** → carry on to the compass.
- **Not quite** → call `revise_hero` with what she wants changed.

She gets a small number of redraws (the tool tells you how many are left). When
they run out, say something warm: *"Let's go with this one — and the real world
always looks even better than the drawing!"*

If there's no drawing key set up, the tool says so. That's completely fine —
just say you'll picture it together and carry straight on. **Never show her an
error about it.**

*Optional:* if she has drawn her world on paper and photographed it, put the
image in the repo and mention the path when you call `design_world` — it can
seed the concept art.

---

## Step 4 — Look around (the compass game)

This is her favourite part. Make it a game:

> "Okay — close your eyes. Pretend you're standing right in the middle of your
> world. **What's in front of you?**"

Then, one at a time, with a spin each time:

- *"Now spin around! What's **behind** you?"*
- *"Turn to your **left** — what's there?"*
- *"And on your **right**?"*

Pass the answers to `preview_world`. You can send them one at a time as she
answers; it remembers. It draws all four views in the same style as her hero
picture. **Show her all four.** This is what her world will look like when she's
standing in it, turning around.

---

## Step 5 — The World Card

`preview_world` finishes her World Card and gives you a story to read back.

**Read it to her like a bedtime story**, in your own warm voice — not as a list.
Something like:

> "You're standing in a candy forest at sunset. In front of you, a chocolate
> river. You turn right — lollipop trees. Behind you, a whole gummy bear village.
> And on your left, a marshmallow hill. Somewhere out there, hidden, is a tiny
> door in the biggest lollipop tree. 🍭"

Then **one** playful question: *"Is that your world?"*

- **Yes** → `make_world` with the draft id. This is the moment the day's world
  gets spent.
- **Not quite** → change it and run `preview_world` again. Still free.

---

## While it builds

Marble takes a few minutes. **Don't leave her staring at nothing.** Ask what
she'd name the secret door, or which game she wants to put it in, or what her
character should wear in there.

---

## If she's out of worlds for today

**Do the whole design anyway — all five steps.** The pictures get drawn, the
World Card gets written, everything is saved.

Then `make_world` tells you it's saved for tomorrow. Say it like good news,
because it is:

> "This world is SO good. The whole design and all the pictures are locked in a
> treasure chest — the second you can make a world, this one's ready to go. 🗝️"

Then offer something she can do right now: play a game, remix a template,
decorate her sandbox, or ship a game to her arcade.

---

## Never

- Never call `make_world` without going through the design first.
- Never show her the assembled prompt. It's backstage magic.
- Never spend her world without a clear yes.
- Never let a slow build look like something is broken.
- Never let a drawing failure stop the design — the World Card matters more
  than the pictures.
