// Reads a Twitch channel's chat. It logs in anonymously (a "justinfan"
// nickname), which is read only and needs no account, token or app.
// Uses the WebSocket client built into Node 22.
const URL = 'wss://irc-ws.chat.twitch.tv:443';

function unescapeTag(v) {
  return v.replace(/\\(.)/g, (_, c) => ({ s: ' ', ':': ';', '\\': '\\', r: '\r', n: '\n' })[c] ?? c);
}

export function parseIrc(line) {
  const msg = { tags: {}, prefix: '', command: '', params: [] };
  let i = 0;
  if (line[0] === '@') {
    const sp = line.indexOf(' ');
    for (const kv of line.slice(1, sp).split(';')) {
      const eq = kv.indexOf('=');
      if (eq < 0) msg.tags[kv] = '';
      else msg.tags[kv.slice(0, eq)] = unescapeTag(kv.slice(eq + 1));
    }
    i = sp + 1;
  }
  if (line[i] === ':') {
    const sp = line.indexOf(' ', i);
    msg.prefix = line.slice(i + 1, sp);
    i = sp + 1;
  }
  const rest = line.slice(i);
  const t = rest.indexOf(' :');
  const head = t >= 0 ? rest.slice(0, t) : rest;
  const parts = head.split(' ').filter(Boolean);
  msg.command = parts.shift() || '';
  msg.params = parts;
  if (t >= 0) msg.params.push(rest.slice(t + 2));
  return msg;
}

// A PRIVMSG as { user, text }, or null for anything else.
export function chatFromIrc(msg) {
  if (msg.command !== 'PRIVMSG') return null;
  let text = msg.params[1] || '';
  const action = /^\u0001ACTION (.*)\u0001$/.exec(text);
  if (action) text = action[1];
  const login = msg.prefix.split('!')[0];
  const badges = msg.tags.badges || '';
  const broadcaster = /(^|,)broadcaster\//.test(badges);
  return {
    user: {
      id: msg.tags['user-id'] || login,
      login,
      name: msg.tags['display-name'] || login,
      color: msg.tags.color || '',
      mod: msg.tags.mod === '1' || broadcaster,
      broadcaster,
    },
    text,
  };
}

export class TwitchChat {
  constructor(channel, onChat) {
    this.channel = channel;
    this.onChat = onChat;
    this.status = 'idle';
    this.ws = null;
    this.retry = 0;
    this.stopped = false;
    this.lastLine = 0;
    this.watchdog = null;
  }

  start() {
    this.stopped = false;
    this.connect();
    // Twitch pings about every five minutes. If we hear nothing for seven,
    // the connection is dead even if the socket has not noticed yet.
    this.watchdog = setInterval(() => {
      if (this.status === 'connected' && Date.now() - this.lastLine > 7 * 60e3) {
        console.warn('[twitch] silent for too long, reconnecting');
        this.ws?.close();
      }
    }, 60e3);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.watchdog);
    this.ws?.close();
  }

  connect() {
    this.status = 'connecting';
    const ws = new WebSocket(URL);
    this.ws = ws;
    ws.addEventListener('open', () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send('PASS SCHMOOPIIE');
      ws.send('NICK justinfan' + Math.floor(10000 + Math.random() * 80000));
      ws.send('JOIN #' + this.channel);
    });
    ws.addEventListener('message', (ev) => {
      this.lastLine = Date.now();
      for (const line of String(ev.data).split('\r\n')) if (line) this.handle(line);
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.status = 'disconnected';
      if (this.stopped) return;
      const wait = Math.min(30, 2 ** this.retry++) * 1000;
      console.warn('[twitch] disconnected, retrying in ' + wait / 1000 + 's');
      setTimeout(() => this.connect(), wait);
    });
    ws.addEventListener('error', (ev) => {
      console.warn('[twitch] socket error:', ev.message || ev.error?.message || 'unknown');
    });
  }

  handle(line) {
    const msg = parseIrc(line);
    if (msg.command === 'PING') {
      this.ws.send('PONG :' + (msg.params[0] || 'tmi.twitch.tv'));
    } else if (msg.command === 'JOIN' && this.status !== 'connected') {
      this.status = 'connected';
      this.retry = 0;
      console.log('[twitch] reading chat of #' + this.channel);
    } else if (msg.command === 'RECONNECT') {
      this.ws.close();
    } else if (msg.command === 'NOTICE') {
      console.warn('[twitch] notice:', msg.params[1]);
    } else {
      const chat = chatFromIrc(msg);
      if (chat) this.onChat(chat.user, chat.text);
    }
  }
}
