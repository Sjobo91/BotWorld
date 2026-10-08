# BotWorld game design

BotWorld is one long game that chat plays together. It starts on an empty island with sticks and stones and, over about two months, grows into a glowing future city. Nobody controls it but chat: every building, every helping hand and every vote comes from a chat command.

## The arc

| Era | What it is about | New goods | Wonder |
| --- | --- | --- | --- |
| 🪨 Stone Age | Huts, woodcutters, quarries, berry gatherers, fishing huts | wood, stone, food | 🗿 Stone Circle |
| 🌾 Village | Farms, windmills, kilns for bricks, markets | bricks | 🏛️ Great Hall |
| 🏰 Medieval Town | Mines, townhouses, schools, harbors | coal, iron | ⛪ Cathedral |
| 🏭 Industrial Age | Steel mills, factories, coal power plants, a train | steel, parts | 🕰️ Clock Tower |
| ⚡ Electric City | Skyscrapers, wind turbines, solar farms, chip fabs, labs | chips | 🗼 Skyline Tower |
| ✨ Future | Arcologies, fusion reactors, robot factories, a maglev | | 💠 Fusion Spire |

Lighting the Fusion Spire is the finale. After that the island keeps going in the Future era, so chat can keep building.

## How an era ends

Three bars on screen, all three must be full:

1. **People.** Homes give room (a hut 4, an arcology 120), people move in while there is food and the town is not miserable, and they eat food every minute.
2. **The wonder.** A big build in the ring around the landing pad. It takes goods a little at a time, and always leaves a fifth of the storage room for normal builds, so building never stops. Bots sent with `!work wonder` carry crates to it and make it go faster.
3. **Knowledge.** Grows with time: an era takes `eraDays` (default 9) days at base speed. Campfires, schools and labs make it up to 50% faster, a meteor shower adds 3 hours at once.

This is what stretches the game to about two months: chat can speed it up, but even a busy chat cannot rush through an era in a day. The balance script (`npm run balance`) plays the whole game in pretend time:

| Chat | Finale |
| --- | --- |
| 2 regular viewers | day 66 |
| 5 regular viewers | day 50 |
| 30 regular viewers | day 46 |

When an era starts, older buildings that have a modern version rebuild themselves (a gatherer becomes a farm, a coal plant becomes a fusion reactor), homes can be upgraded with `!upgrade`, and the island looks different: the paths, street lights, boats, bots and even the air change with the era.

## The economy

Every 5 seconds the server runs one step:

* **Producers** make goods once a minute at full speed, if they have workers (people), the goods they need (a kiln eats stone and wood to make bricks) and power. Helpers sent with `!work` add speed. Happy towns work faster.
* **Storage** limits every good (start 100, stockpiles, barns and warehouses add room). A full store stops its producers.
* **Power** (from the Industrial Age) comes from coal plants (burn coal), wind turbines, solar farms (only by day, following the real sun) and fusion. Factories, skyscrapers and labs need it, and run slower when there is not enough.
* **Happiness** comes from parks, gardens, fountains, statues, stadiums and other decor near homes, and drops when people are hungry or the power is out.
* **Needs.** The server works out what the town is short of and the building that helps most, and shows it on screen ("The wonder needs stone: !build quarry"). The how-to card highlights those buildings.

## Viewers

* The first `!build` gives a viewer their own bot, with a color and a hat.
* **XP** for building, working, hauling, repairing, voting and coming back daily (streaks give more). Levels unlock hats and more building slots (3 at the start, more with level and era, up to 30).
* `!me` shows a viewer card on stream. The top builders of the week are on screen too.
* When the island is completely full, buildings of viewers who have been away for more than a week are the first to make room for new ones. A full island also tells a viewer which of their own old buildings to `!demolish`.

## Votes and events

About once an hour (when at least two people chatted in the last half hour) chat votes between three events with `!1`, `!2` or `!3`. Calm events also happen on their own now and then.

| Event | Effect |
| --- | --- |
| 🎉 Festival | everyone happier for 30 minutes |
| 🌾 Big Harvest, 🌲 Tall Trees, 💎 Rich Veins | double food, wood, or stone, coal and iron |
| ⛵ Merchant Ship | a gift of the goods the town has least of |
| ☄️ Meteor Shower | +3 hours of knowledge |
| 🔨 Builder Rush | builds go twice as fast |
| ⛈️ Storm | breaks 3 buildings until someone types `!repair` |
| 🔌 Blackout | breaks a power plant (Industrial Age and later) |

Moderators can start a vote with `!vote start` or an event with `!event storm`.

## The Gazette

Every half hour a newspaper headline about the island appears at the bottom of the stream. It is written from what happened since the last one (new era, finished wonder, storm, level ups, new viewers, a building boom, what the town is short of). Templates write it out of the box; with an Anthropic API key Claude writes it.

## Every era and building

### 1. 🪨 Stone Age: Sticks and stones

To move on: 25 people, the 🗿 Stone Circle (500 stone, 250 wood, 150 food) and a full knowledge bar.

| Build | Cost | What it does |
| --- | --- | --- |
| 🛖 `hut` | 8 wood, 4 stone | homes for 4 |
| 🪓 `woodcutter` | 4 stone | makes 2 wood a minute, 2 workers |
| ⛏️ `quarry` | 6 wood | makes 2 stone a minute, 2 workers |
| 🫐 `gatherer` | 4 wood | makes 2 food a minute, 1 worker, becomes a farm later |
| 🎣 `fisher` | 10 wood | makes 3 food a minute, 1 worker, becomes a harbor later |
| 🔥 `campfire` | 5 wood | +6 happiness nearby, knowledge +5% |
| 📦 `stockpile` | 12 wood | +60 storage, becomes a barn later |
| 🗿 `totem` | 6 wood, 14 stone | +14 happiness nearby, becomes a statue later |

### 2. 🌾 Village: Farms and bricks

To move on: 70 people, the 🏛️ Great Hall (1200 wood, 800 bricks, 500 food) and a full knowledge bar.

| Build | Cost | What it does |
| --- | --- | --- |
| 🏠 `cottage` | 12 wood, 8 bricks | homes for 7 |
| 🌾 `farm` | 14 wood, 6 stone | makes 5 food a minute, 2 workers, becomes a greenhouse later |
| 🌬️ `windmill` | 20 wood, 10 stone | farms nearby +50%, 1 worker |
| 🧱 `kiln` | 14 stone, 8 wood | 2 stone, 1 wood → 2 bricks a minute, 2 workers |
| 🪣 `well` | 15 stone | +10 happiness nearby, becomes a fountain later |
| 🏪 `market` | 16 wood, 10 bricks | +20 happiness nearby, 2 workers |
| 🌷 `garden` | 6 wood | +7 happiness nearby |
| 🌳 `park` | 8 wood, 4 stone | +10 happiness nearby |
| 🏚️ `barn` | 20 wood, 10 bricks | +150 storage, becomes a warehouse later |

### 3. 🏰 Medieval Town: Coal and iron

To move on: 150 people, the ⛪ Cathedral (2500 stone, 1500 bricks, 500 iron) and a full knowledge bar.

| Build | Cost | What it does |
| --- | --- | --- |
| 🏘️ `townhouse` | 18 bricks, 12 stone, 2 iron | homes for 12 |
| ⚒️ `mine` | 30 wood, 20 stone | makes 2 coal, 1 iron a minute, 3 workers |
| 🏰 `tower` | 40 stone, 4 iron | +20 happiness nearby, upgrades to level 3 |
| 🏫 `school` | 24 bricks, 12 wood | +5 happiness nearby, knowledge +10%, 2 workers, becomes a research lab later |
| ⚓ `harbor` | 40 wood, 6 iron | makes 8 food a minute, 3 workers |
| 🗼 `lighthouse` | 40 stone, 12 bricks | +15 happiness nearby |
| ⛲ `fountain` | 30 stone, 2 iron | +18 happiness nearby |
| 🗽 `statue` | 40 stone, 6 iron | +25 happiness nearby, becomes a holo park later |

### 4. 🏭 Industrial Age: Steam and steel

To move on: 300 people, the 🕰️ Clock Tower (2500 bricks, 2000 steel, 600 parts) and a full knowledge bar.

| Build | Cost | What it does |
| --- | --- | --- |
| 🏢 `apartments` | 40 bricks, 8 steel | homes for 24 |
| 🏭 `steelmill` | 50 bricks, 30 iron | 2 iron, 2 coal → 2 steel a minute, 4 workers |
| 🔥 `coalplant` | 40 bricks, 10 steel | burns 2 coal a minute, +20 power, 3 workers, becomes a fusion reactor later |
| ⚙️ `factory` | 60 bricks, 30 steel | 2 steel → 2 parts a minute, needs 8 power, 5 workers |
| 🏬 `warehouse` | 40 bricks, 10 steel | +400 storage |
| 🚉 `station` | 60 steel, 40 bricks | +30 happiness nearby, a train runs round the island |
| 💧 `watertower` | 20 steel | +15 happiness nearby |

### 5. ⚡ Electric City: Power for everyone

To move on: 600 people, the 🗼 Skyline Tower (5000 steel, 2000 parts, 600 chips) and a full knowledge bar.

| Build | Cost | What it does |
| --- | --- | --- |
| 🏙️ `skyscraper` | 60 steel, 20 parts | homes for 50, needs 6 power |
| 🌀 `turbine` | 30 steel, 10 parts | +15 power |
| ☀️ `solar` | 20 steel, 16 parts | +20 power (by day) |
| 💾 `chipfab` | 60 steel, 40 parts | 2 parts → 1 chips a minute, needs 15 power, 6 workers |
| 🔬 `lab` | 40 steel, 10 chips | needs 6 power, knowledge +15%, 3 workers |
| 🏟️ `stadium` | 120 steel, 40 parts | needs 5 power, +80 happiness nearby |
| 🌱 `greenhouse` | 30 steel, 10 parts | makes 20 food a minute, needs 4 power, 2 workers, becomes a vertical farm later |

### 6. ✨ Future: A bright tomorrow

To move on: 1200 people, the 💠 Fusion Spire (9000 steel, 3000 parts, 3000 chips) and a full knowledge bar.

| Build | Cost | What it does |
| --- | --- | --- |
| 🌐 `arcology` | 120 steel, 40 chips | homes for 120, needs 10 power |
| ⚛️ `fusion` | 200 steel, 80 chips | +120 power, 4 workers |
| 🤖 `robofactory` | 150 steel, 60 chips | needs 20 power, every producer +25%, 2 workers |
| 🥬 `vertifarm` | 80 steel, 20 chips | makes 60 food a minute, needs 10 power, 2 workers |
| 🚄 `maglev` | 300 steel, 100 chips | +60 happiness nearby, a train runs round the island |
| 🌈 `holopark` | 20 steel, 20 chips | needs 4 power, +60 happiness nearby |
| 🛸 `droneport` | 120 steel, 60 chips | needs 10 power, wonder goes faster, 2 workers |

The full list, with build times and placement rules, is in `public/shared/catalog.js`. Changing numbers there and running `npm run balance` shows how the pacing changes.
