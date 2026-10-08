# BotWorld game design

BotWorld is one long game that chat plays together. It starts with a landing pad in a clearing, a few huts and sticks and stones, in the middle of a big world nobody has seen yet. Over about two months chat explores that world and grows the town into a glowing future city. Nobody controls it but chat: every home, every project, every scouting trip and every vote comes from a chat command.

![The world on day 1, in the Medieval Town and in the Electric City](world.jpg)

## The world

* **Big and made from a seed.** A hex map of 4,921 tiles (41 rings around the pad, about ten times the old island). The server and every page build the same map from the same seed, so the map itself is never sent around.
* **Land types:** grassland, berry meadows, forests, rocky hills, mountains (bots walk around them), lakes, rivers (bots wade through) and a sea coast on one side. In the hills and mountains lie **coal and iron deposits**; far out there are **ancient ruins** and **old stone tablets**.
* **Fog.** At the start only the land within 6 tiles of the pad is known. Everything else is fog, like in Age of Empires. Land is revealed by scouts (`!explore`), around every new building, and much further around towers and lighthouses. Explored land rises out of the fog on stream.
* **What scouts find:** ore deposits (needed for mines from the Medieval Town on), ruins (a gift of the goods the town has least of) and tablets (two hours of knowledge). Every map guarantees wood, stone and berries near the start, and coal and iron within about 13 tiles.

## Homes and town projects

* **Your own home.** `!home` builds one home per viewer, near the middle of town. It has a rim and a flag in the viewer's colour, so everyone can see whose it is, and `!me` puts an arrow and a column of light in your colour over your bot for 20 seconds and flies the camera to it. Everyone on a stream sees the same picture, so this is how a viewer finds their own bot. `!upgrade` makes it bigger (three levels), and every new era turns it into that era's kind of home (hut, cottage, townhouse, apartments, skyscraper, arcology).
* **Everything else is built together.** `!build farm` starts a town project, at most three at a time. It needs its goods first, then work: every bot that types `!help` adds one share of work per second, and the townsfolk always add a little, so a project also finishes when chat is asleep. A hut takes one bot about two minutes and four bots half a minute. Helpers earn XP for the time they put in, and the finished building is credited to its builders.
* **Short jobs.** Every command keeps a bot busy for about half a minute and then shows what it did, so chat keeps typing and sees progress. `!help` is a 40 second shift on a project (one share of work per second), `!work bricks` 60 seconds at a building, `!explore` a trip into the fog. Typed while the bot is busy, jobs wait in line, up to 5 (`!wood 3` lines up three, `!stop` clears the line). Every job pays a little XP, which pops up over the bot.
* **Gathering by hand.** `!wood`, `!stone` and `!food` (and `!coal` and `!iron` from the Medieval Town) send your bot on one trip to the nearest known land of the right kind: a forest, rocky hills, a berry meadow (or the water with `!fish`), a coal or iron deposit. It walks out, works there 8 seconds and carries the crate back to the nearest store; the trip takes about half a minute near town and longer far out. Chat always has something useful to do, even before the first woodcutter stands. Buildings make more and keep going while chat sleeps. Goods made from other goods (bricks, steel, parts, chips) come only from their building; `!work bricks` sends your bot to help at a kiln.
* **Tools.** A bot starts with stone tools and carries 2 goods per trip. `!upgrade tools` buys the next set from the town storage once the viewer is high enough and the era has the material:

| Tools | Level | Era | Costs | Per trip | Building speed |
| --- | --- | --- | --- | --- | --- |
| Stone | 1 | Stone Age | | 2 | 1x |
| Copper | 3 | Village | 6 bricks, 6 wood | 3 | 1.25x |
| Iron | 6 | Medieval Town | 8 iron | 4 | 1.5x |
| Steel | 10 | Industrial Age | 8 steel | 5 | 1.75x |
| Power | 15 | Electric City | 8 parts | 6 | 2x |
| Laser | 20 | Future | 6 chips | 8 | 2.5x |

* **Building upgrades.** `!upgrade woodcutter` (or `!upgrade #12`) starts a town project that takes a finished building to level 2, and later 3. It costs 1.5 times the building's price (2.25 times for level 3) and half its work per level, is built with `!help` like any project, and the building keeps working meanwhile. Every level makes 50% more of what it gives: goods, power, storage room, people or knowledge. Upgraded buildings fly a silver (level 2) or gold (level 3) pennant.
* **The land decides where.** The server picks the best known spot: woodcutters next to a forest, quarries next to rocky hills, gatherers next to berries, fishers and harbors on the water, mines near a coal or iron deposit, farms on grassland. A spot with more of the right land around it produces more (up to 60% more, or 40% less on a poor spot). If no right spot is known yet, the town is told to explore.

## What chat sees

* **What to do now:** the top of the screen always shows the next steps with the command to type, worked out by the server. Help the project that is being built, gather the goods a project waits for (`!wood`), start what the town needs (`!build quarry`), explore when the right land is missing, haul to the wonder, build more homes when people need room, or explore the fog.
* **Being built:** every project with its progress and helpers, and the homes going up.
* **The how-to card** takes turns showing the commands, where every good comes from (which building makes it and what land it needs) and this era's buildings with their costs. The goods page shows both ways for every good: the command to gather it by hand, and the building that makes it all day.

## The arc

| Era | What it is about | New goods | Wonder |
| --- | --- | --- | --- |
| 🪨 Stone Age | Huts, woodcutters, quarries, berry gatherers, fishing huts | wood, stone, food | 🗿 Stone Circle |
| 🌾 Village | Farms, windmills, kilns for bricks, markets | bricks | 🏛️ Great Hall |
| 🏰 Medieval Town | Mines on coal and iron, townhouses, schools, harbors | coal, iron | ⛪ Cathedral |
| 🏭 Industrial Age | Steel mills, factories, coal power plants, a train | steel, parts | 🕰️ Clock Tower |
| ⚡ Electric City | Skyscrapers, wind turbines, solar farms, chip fabs, labs | chips | 🗼 Skyline Tower |
| ✨ Future | Arcologies, fusion reactors, robot factories, a maglev | | 💠 Fusion Spire |

Lighting the Fusion Spire is the finale. After that the town keeps going in the Future era.

## How an era ends

Three bars on screen, all three must be full:

1. **People.** Homes give room (your own home 3 to 5 people, a town hut 6, an arcology 140). People move in while there is food and the town is not miserable, and they eat food every minute.
2. **The wonder.** A big build in the ring around the landing pad. It takes goods a little at a time and always leaves a fifth of the storage room for normal builds. Bots on `!help wonder` carry crates to it and make it go faster.
3. **Knowledge.** Grows with time: an era takes `eraDays` (default 11) days at base speed. Campfires, schools and labs make it up to 50% faster, meteor showers and old tablets add hours at once.

This is what stretches the game to about two months: chat can speed it up, but even a busy chat cannot rush through an era in a day. The balance script (`npm run balance`) plays the whole game in pretend time:

| Era starts | 2 viewers | 5 viewers |
| --- | --- | --- |
| 🌾 Village | day 9.2 | day 9.2 |
| 🏰 Medieval Town | day 18.5 | day 18.3 |
| 🏭 Industrial Age | day 28.2 | day 27.4 |
| ⚡ Electric City | day 37.7 | day 37.0 |
| ✨ Future | day 48.3 | day 47.2 |
| Finale (Fusion Spire lit) | day 55.0 | day 56.1 |

Each pretend viewer is online an hour and a half a day and types a command about every minute. Because eras wait on knowledge, the finale lands at about two months whether two or five regulars play; a busy chat builds a much bigger town on the way.

When an era starts, older buildings that have a modern version rebuild themselves (a gatherer becomes a farm, huts become cottages, a coal plant becomes a fusion reactor), homes become the new kind of home, and the town looks different: the roads, street lights, boats, bots and even the air change with the era.

## The economy

Every 5 seconds the server runs one step:

* **Producers** make goods once a minute at full speed, if they have workers (people), the goods they need (a kiln eats stone and wood to make bricks) and power, scaled by how good their spot is. Helpers sent with `!work bricks` (and so on) add speed. Goods gathered by hand go straight into storage. Happy towns work faster.
* **Storage** limits every good (start 100, stockpiles, barns and warehouses add room). A full store stops its producers.
* **Power** (from the Industrial Age) comes from coal plants (burn coal), wind turbines, solar farms (only by day, following the real sun) and fusion. Factories, skyscrapers and labs need it.
* **Happiness** comes from parks, gardens, fountains, statues, stadiums and other decor near homes, and drops when people are hungry or the power is out.

## Viewers

* Any command gives a viewer their own bot, with a colour and a hat. Bots land from the rocket on the pad.
* **XP** for building, helping, hauling, exploring, repairing, voting and coming back daily (streaks give more). Levels unlock hats.
* `!me` shows a card on stream (level, home, buildings helped, trips into the fog, rank) and flies the camera to your home. The top builders of the week are on screen too.

## Votes and events

About once an hour (when at least two people chatted in the last half hour) chat votes between three events with `!1`, `!2` or `!3`. Calm events also happen on their own now and then.

| Event | Effect |
| --- | --- |
| 🎉 Festival | everyone happier for 30 minutes |
| 🌾 Big Harvest, 🌲 Tall Trees, 💎 Rich Veins | double food, wood, or stone, coal and iron |
| ⛵ Merchant Ship | a gift of the goods the town has least of |
| ☄️ Meteor Shower | +3 hours of knowledge |
| 🔨 Builder Rush | building goes twice as fast |
| ⛈️ Storm | breaks 3 buildings until someone types `!repair` |
| 🔌 Blackout | breaks a power plant (Industrial Age and later) |

Moderators can start a vote with `!vote start` or an event with `!event storm`.

## The Gazette

Every half hour a newspaper headline about the town appears at the bottom of the stream. It is written from what happened since the last one: a new era, a finished wonder, storms, discoveries, level ups, new viewers, a building boom, what the town is short of. Templates write it out of the box; with an Anthropic API key Claude writes it.

## Every era and building

### 1. 🪨 Stone Age: Sticks and stones

To move on: 25 people, the 🗿 Stone Circle (500 stone, 250 wood, 150 food) and a full knowledge bar.

| Build | Cost | Needs | What it does |
| --- | --- | --- | --- |
| 🛖 `hut` | 12 wood, 6 stone |  | homes for 6, becomes a cottage later |
| 🪓 `woodcutter` | 4 stone | next to a forest | makes 2 wood a minute, 2 workers |
| ⛏️ `quarry` | 6 wood | next to rocky hills | makes 2 stone a minute, 2 workers |
| 🫐 `gatherer` | 4 wood | next to a berry meadow | makes 2 food a minute, 1 worker, becomes a farm later |
| 🎣 `fisher` | 10 wood | next to water | makes 3 food a minute, 1 worker, becomes a harbor later |
| 🔥 `campfire` | 5 wood |  | +6 happiness nearby, knowledge +5% |
| 📦 `stockpile` | 12 wood |  | +60 storage, becomes a barn later |
| 🗿 `totem` | 6 wood, 14 stone |  | +14 happiness nearby, becomes a statue later |

### 2. 🌾 Village: Farms and bricks

To move on: 70 people, the 🏛️ Great Hall (1200 wood, 800 bricks, 500 food) and a full knowledge bar.

| Build | Cost | Needs | What it does |
| --- | --- | --- | --- |
| 🏠 `cottage` | 16 wood, 10 bricks |  | homes for 10, becomes a townhouse later |
| 🌾 `farm` | 14 wood, 6 stone | next to grassland | makes 5 food a minute, 2 workers, becomes a greenhouse later |
| 🌬️ `windmill` | 20 wood, 10 stone |  | farms nearby +50%, 1 worker |
| 🧱 `kiln` | 14 stone, 8 wood |  | 2 stone, 1 wood → 2 bricks a minute, 2 workers |
| 🪣 `well` | 15 stone |  | +10 happiness nearby, becomes a fountain later |
| 🏪 `market` | 16 wood, 10 bricks |  | +20 happiness nearby, 2 workers |
| 🌷 `garden` | 6 wood |  | +7 happiness nearby |
| 🌳 `park` | 8 wood, 4 stone |  | +10 happiness nearby |
| 🏚️ `barn` | 20 wood, 10 bricks |  | +150 storage, becomes a warehouse later |

### 3. 🏰 Medieval Town: Coal and iron

To move on: 150 people, the ⛪ Cathedral (2500 stone, 1500 bricks, 500 iron) and a full knowledge bar.

| Build | Cost | Needs | What it does |
| --- | --- | --- | --- |
| 🏘️ `townhouse` | 22 bricks, 14 stone, 3 iron |  | homes for 16, becomes a apartment block later |
| ⚒️ `mine` | 30 wood, 20 stone | near a coal or iron deposit | makes 2 coal, 1 iron a minute, 3 workers |
| 🏰 `tower` | 40 stone, 4 iron |  | +20 happiness nearby |
| 🏫 `school` | 24 bricks, 12 wood |  | +5 happiness nearby, knowledge +10%, 2 workers, becomes a research lab later |
| ⚓ `harbor` | 40 wood, 6 iron | next to the sea or a lake | makes 8 food a minute, 3 workers |
| 🗼 `lighthouse` | 40 stone, 12 bricks | next to the sea | +15 happiness nearby |
| ⛲ `fountain` | 30 stone, 2 iron |  | +18 happiness nearby |
| 🗽 `statue` | 40 stone, 6 iron |  | +25 happiness nearby, becomes a holo park later |

### 4. 🏭 Industrial Age: Steam and steel

To move on: 300 people, the 🕰️ Clock Tower (2500 bricks, 2000 steel, 600 parts) and a full knowledge bar.

| Build | Cost | Needs | What it does |
| --- | --- | --- | --- |
| 🏢 `apartments` | 45 bricks, 10 steel |  | homes for 32, becomes a skyscraper later |
| 🏭 `steelmill` | 50 bricks, 30 iron |  | 2 iron, 2 coal → 2 steel a minute, 4 workers |
| 🔥 `coalplant` | 40 bricks, 10 steel |  | burns 2 coal a minute, +20 power, 3 workers, becomes a fusion reactor later |
| ⚙️ `factory` | 60 bricks, 30 steel |  | 2 steel → 2 parts a minute, needs 8 power, 5 workers |
| 🏬 `warehouse` | 40 bricks, 10 steel |  | +400 storage |
| 🚉 `station` | 60 steel, 40 bricks |  | +30 happiness nearby, a train runs round the town |
| 💧 `watertower` | 20 steel |  | +15 happiness nearby |

### 5. ⚡ Electric City: Power for everyone

To move on: 600 people, the 🗼 Skyline Tower (5000 steel, 2000 parts, 600 chips) and a full knowledge bar.

| Build | Cost | Needs | What it does |
| --- | --- | --- | --- |
| 🏙️ `skyscraper` | 70 steel, 24 parts |  | homes for 64, needs 6 power, becomes a arcology later |
| 🌀 `turbine` | 30 steel, 10 parts |  | +15 power |
| ☀️ `solar` | 20 steel, 16 parts |  | +20 power (by day) |
| 💾 `chipfab` | 60 steel, 40 parts |  | 2 parts → 1 chips a minute, needs 15 power, 6 workers |
| 🔬 `lab` | 40 steel, 10 chips |  | needs 6 power, knowledge +15%, 3 workers |
| 🏟️ `stadium` | 120 steel, 40 parts |  | needs 5 power, +80 happiness nearby |
| 🌱 `greenhouse` | 30 steel, 10 parts |  | makes 20 food a minute, needs 4 power, 2 workers, becomes a vertical farm later |

### 6. ✨ Future: A bright tomorrow

To move on: 1200 people, the 💠 Fusion Spire (9000 steel, 3000 parts, 3000 chips) and a full knowledge bar.

| Build | Cost | Needs | What it does |
| --- | --- | --- | --- |
| 🌐 `arcology` | 130 steel, 45 chips |  | homes for 140, needs 10 power |
| ⚛️ `fusion` | 200 steel, 80 chips |  | +120 power, 4 workers |
| 🤖 `robofactory` | 150 steel, 60 chips |  | needs 20 power, every producer +25%, 2 workers |
| 🥬 `vertifarm` | 80 steel, 20 chips |  | makes 60 food a minute, needs 10 power, 2 workers |
| 🚄 `maglev` | 300 steel, 100 chips |  | +60 happiness nearby, a train runs round the town |
| 🌈 `holopark` | 20 steel, 20 chips |  | needs 4 power, +60 happiness nearby |
| 🛸 `droneport` | 120 steel, 60 chips |  | needs 10 power, wonder goes faster, 2 workers |

The full list, with build times, is in `public/shared/catalog.js`, the land rules in `public/shared/terrain.js`. Changing numbers there and running `npm run balance` shows how the pacing changes.
