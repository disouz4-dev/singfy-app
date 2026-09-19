// midi.js — Controlador MIDI "chocolate" (SINCO MIDI 1)
// Envia mensagens CC ch1 control 0 com valores que mapeiam comandos do show mode.
// Mapeamento (CC control 0):
//   0 = parar rolagem     1 = play na rolagem
//   3 = ocultar cifra     4 = mostrar cifra
//   5 = diminuir velocidade  7 = aumentar velocidade
//   6 = música anterior   8 = próxima música
//
// Suporta dois transportes:
//   1) Web MIDI API (USB ou BT pareado no sistema) — caminho principal.
//   2) Web Bluetooth (BLE-MIDI direto) — fallback para tablets/pareamento no app.

const COMMANDS = {
  0: 'stop',
  1: 'play',
  3: 'hideChords',
  4: 'showChords',
  5: 'speedDown',
  7: 'speedUp',
  6: 'prevSong',
  8: 'nextSong'
};

// GATT BLE MIDI do padrão MMA
const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
const BLE_MIDI_CHAR = '7772e5db-3868-4112-a1a9-f2669d106bf3';

// Decodifica um pacote BLE-MIDI (timestamp header + mensagens MIDI) e retorna
// um array de mensagens no formato [status, d1, d2].
//
// Regra do Time Stamp Header (spec BLE-MIDI): se o bit 7 do primeiro byte
// estiver setado, há timestamp; se os bits 7 e 6 estiverem setados (0b11),
// o timestamp ocupa 2 bytes; caso contrário, 1 byte. Timestamps só existem
// no INÍCIO do pacote — depois disso, bytes com bit 7 são status bytes.
//
// Alguns pedais (ex.: FootCtrl) expõem o serviço BLE-MIDI mas mandam MIDI
// "cru" (sem timestamp header). Se o pacote decodifica limpo no formato
// padrão BLE-MIDI, ele é usado; caso contrário, tenta o MIDI cru.
// No uso real de pedal, cada acionamento gera 1 mensagem por pacote, então
// o formato padrão (autoritativo) tem precedência sempre que for consistente.
export function bleToMidi(bytes) {
  const spec = decodeSpec(bytes);
  if (spec.clean) return spec.msgs;
  return decodeRaw(bytes).msgs;
}

// Quantos bytes de dados a mensagem com este status carrega
function dataLength(status) {
  const t = status & 0xf0;
  if (t === 0xc0 || t === 0xd0) return 1;
  if (status === 0xf1 || status === 0xf3) return 1;
  if (status === 0xf2) return 2;
  if (status >= 0xf0) return 0;
  return 2;
}

// BLE-MIDI (spec MMA): [header][timestamp][status][dados]... Cada mensagem é
// precedida de um byte de timestamp (bit 7 = 1). Timestamp seguido de dado
// (bit 7 = 0) = running status. Mensagens de tempo real (F8–FF) não alteram
// o running status.
function decodeSpec(bytes) {
  const out = [];
  let dirty = false;
  if (!bytes.length || !(bytes[0] & 0x80)) return { msgs: out, count: 0, clean: false };
  let i = 1;
  let running = null;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b & 0x80) {
      if (i + 1 < bytes.length && (bytes[i + 1] & 0x80)) {
        i++; // b era timestamp; o próximo é status
        const status = bytes[i++];
        if (status >= 0xf8) { out.push([status]); continue; }
        running = status;
      } else {
        i++; // timestamp seguido de dados -> running status
      }
      continue;
    }
    if (running === null) { dirty = true; i++; continue; }
    const len = dataLength(running);
    if (len === 0 || i + len > bytes.length) { dirty = true; i++; continue; }
    out.push([running, ...bytes.slice(i, i + len)]);
    i += len;
  }
  return { msgs: out, count: out.length, clean: out.length > 0 && !dirty };
}

// MIDI cru (sem timestamp), com running status.
function decodeRaw(bytes) {
  const out = [];
  let dirty = false;
  let running = null;
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b & 0x80) {
      i++;
      if (b >= 0xf8) { out.push([b]); continue; }
      running = b;
      continue;
    }
    if (running === null) { dirty = true; i++; continue; }
    const len = dataLength(running);
    if (len === 0 || i + len > bytes.length) { dirty = true; i++; continue; }
    out.push([running, ...bytes.slice(i, i + len)]);
    i += len;
  }
  return { msgs: out, count: out.length, clean: out.length > 0 && !dirty };
}

export class MidiController {
  constructor() {
    this.access = null;     // Web MIDI access
    this.bleDevice = null;  // dispositivo Web Bluetooth
    this.bleChar = null;    // characteristic BLE-MIDI
    this.connected = false;
    this.transport = null;  // 'webmidi' | 'bluetooth'
    this.onCommand = null;  // (command: string, value: number) => void
    this.onDisconnect = null; // () => void (quando BT cair ou usuário desconectar)
    this.onMidiPacket = null; // (u8, messages, label) => void — diagnóstico BT
    this._bleSubscriptions = [];
    this._bleSubscribeErrors = [];
  }

  get availableWebMidi() {
    return typeof navigator.requestMIDIAccess === 'function';
  }

  get availableBluetooth() {
    return typeof navigator.bluetooth !== 'undefined' &&
      typeof navigator.bluetooth.requestDevice === 'function';
  }

  // Conecta. Tenta Web MIDI primeiro; se não houver entradas, cai no
  // BLE-MIDI via Web Bluetooth (pede ao usuário escolher o dispositivo).
  async connect() {
    this.disconnect();

    if (this.availableWebMidi) {
      try {
        const access = await navigator.requestMIDIAccess();
        const inputs = this.collectInputs(access);
        if (inputs.length > 0) {
          this.access = access;
          this.connected = true;
          this.transport = 'webmidi';
          this.bindInputs();
          return { transport: 'webmidi', inputs };
        }
        // Sem entradas → tenta Bluetooth (cuidado: access fica sem uso)
      } catch (_) {
        // Web MIDI indisponível/falhou → tenta Bluetooth
      }
    }

    if (this.availableBluetooth) {
      const device = await this.connectBluetooth();
      this.bleDevice = device;
      this.connected = true;
      this.transport = 'bluetooth';
      return { transport: 'bluetooth', device: device.name || 'Dispositivo MIDI' };
    }

    throw new Error('Nenhuma entrada MIDI encontrada e Bluetooth indisponível');
  }

  collectInputs(access) {
    const out = [];
    if (access) access.inputs.forEach((i) => out.push(i.name));
    return out;
  }

  bindInputs() {
    if (!this.access) return;
    this.access.inputs.forEach((inp) => this.bindInput(inp));
    this.access.onstatechange = () => {
      if (this.access) this.access.inputs.forEach((inp) => this.bindInput(inp));
    };
  }

  bindInput(inp) {
    if (inp._singfyBound) return;
    inp._singfyBound = true;
    inp.onmidimessage = (e) => this.handleMessage(e);
  }

  async connectBluetooth() {
    let device;
    try {
      // aceita TODOS os dispositivos BLE por perto (muitos controladores não
      // anunciam o UUID do serviço MIDI no advertisement, então o filtro por
      // serviço os escondia e o pareamento nunca achava nada).
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [BLE_MIDI_SERVICE],
      });
    } catch (err) {
      if (err && (err.name === 'NotFoundError')) {
        throw new Error('Nenhum dispositivo Bluetooth encontrado. Ligue o Bluetooth do controlador (modo BLE) e deixe-o perto do aparelho, depois tente de novo.');
      }
      throw new Error((err && err.message) || 'Falha ao buscar dispositivo Bluetooth');
    }

    this.bleDevice = device;
    device.addEventListener('gattserverdisconnected', () => this.handleBtDrop());

    let server;
    try {
      server = await device.gatt.connect();
    } catch (err) {
      await this.forgetCurrentDevice();
      throw new Error(`Não foi possível conectar em "${device.name || 'dispositivo'}". Talvez ele já esteja conectado em outro app — desconecte e tente de novo.`);
    }

    let service;
    try {
      service = await server.getPrimaryService(BLE_MIDI_SERVICE);
    } catch (_) {
      await this.forgetCurrentDevice();
      throw new Error(`O dispositivo "${device.name || 'desconhecido'}" não expõe o serviço MIDI via Bluetooth. Pode ser que o controlador seja apenas USB (sem Bluetooth).`);
    }

    const characteristic = await service.getCharacteristic(BLE_MIDI_CHAR);
    this.bleChar = characteristic;
    await this.subscribeBleChar(characteristic, 'midi');

    // O padrão MMA permite VÁRIAS características de dados no mesmo serviço;
    // alguns pedais usam UUID custom em vez do padrão. Assina todas as
    // notificáveis do serviço MIDI.
    try {
      const chars = await service.getCharacteristics();
      for (const ch of chars) {
        if (ch.uuid.toLowerCase() === BLE_MIDI_CHAR) continue; // já assinada acima
        await this.subscribeBleChar(ch, 'midi');
      }
    } catch (_) {}

    // Varre os DEMAIS serviços em busca de características com notify/indicate
    // que possam carregar MIDI cru (alguns pedais usam serviço próprio — ex.:
    // o FootCtrl pode trocar dados num serviço custom em vez do GATT padrão).
    try {
      const services = await server.getPrimaryServices();
      for (const s of services) {
        if (s.uuid.toLowerCase() === BLE_MIDI_SERVICE) continue;
        let chars;
        try { chars = await s.getCharacteristics(); } catch (_) { continue; }
        // await: Web Bluetooth só aceita uma operação GATT por vez
        for (const ch of chars) await this.subscribeBleChar(ch, s.uuid);
      }
    } catch (_) {}

    // Alguns pedais só começam a transmitir depois de receber uma escrita no
    // canal MIDI I/O (handshake). Envia um pacote BLE-MIDI vazio (header +
    // timestamp, sem mensagem MIDI) — não gera nota, mas "acorda" o streaming
    // em certos firmwares.
    if (this.bleChar && this.bleChar.properties &&
        this.bleChar.properties.writeWithoutResponse) {
      try {
        await this.bleChar.writeValueWithoutResponse(new Uint8Array([0x80, 0x00]));
      } catch (_) {}
    }

    // Se nenhuma característica com notify foi encontrada/assinada, avisa na
    // tela — assim o usuário distingue "canal inexistente" de "canal mudo".
    if (this._bleSubscriptions.length === 0 && typeof this.onMidiPacket === 'function') {
      const detail = this._bleSubscribeErrors.length ? ' (' + this._bleSubscribeErrors.join(' | ') + ')' : ' (nenhuma com notify)';
      this.onMidiPacket(new Uint8Array(0), [], 'sem-notify' + detail);
    }

    return device;
  }

  // Assina notificações de uma characteristic e roteia os pacotes para o
  // handler compartilhado (decode + diagnóstico). Retorna true se assinou.
  async subscribeBleChar(characteristic, label) {
    const props = characteristic.properties || {};
    if (props.notify !== undefined || props.indicate !== undefined) {
      if (!props.notify && !props.indicate) return false;
    }
    try {
      await characteristic.startNotifications();
    } catch (err) {
      this._bleSubscribeErrors.push(label + ': ' + ((err && err.message) || 'erro'));
      return false;
    }
    this._bleSubscriptions.push(characteristic);
    // O evento da Web Bluetooth é 'characteristicvaluechanged'
    // (não existe 'notificationvaluechanged' — por isso nada chegava via BT).
    if (!characteristic._singfyListener) {
      characteristic._singfyListener = (e) => {
        this.handleBleNotification(e.target.value, label);
      };
      characteristic.addEventListener('characteristicvaluechanged', characteristic._singfyListener);
    }
    return true;
  }

  handleBleNotification(rawValue, label) {
    let u8;
    if (rawValue instanceof Uint8Array) u8 = rawValue;
    else if (rawValue instanceof ArrayBuffer) u8 = new Uint8Array(rawValue);
    else u8 = new Uint8Array(rawValue.buffer, rawValue.byteOffset || 0, rawValue.byteLength || rawValue.buffer.byteLength);
    const messages = bleToMidi(u8);
    if (messages.length === 0 && typeof console !== 'undefined') {
      console.warn('[singfy-midi] pacote BT sem mensagem MIDI (' + label + '):', Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(' '));
    }
    for (const msg of messages) this.processMidiBytes(msg);
    if (typeof this.onMidiPacket === 'function') {
      this.onMidiPacket(u8, messages, label);
    }
  }

  // Desconecta e "esquece" o GATT do dispositivo para não travar o próximo scan
  async forgetCurrentDevice() {
    const dev = this.bleDevice;
    this.bleDevice = null;
    this.bleChar = null;
    this._bleSubscriptions = [];
    if (!dev) return;
    try {
      if (dev.gatt && dev.gatt.connected) dev.gatt.disconnect();
    } catch (_) {}
    try {
      if (typeof dev.forget === 'function') await dev.forget();
    } catch (_) {}
  }

  // Indica se a assinatura de notificação está ativa no dispositivo (lê o CCCD
  // 0x2902 da primeira característica assinada). Erros de leitura apontam
  // pareamento/criptografia pendente (o MIDI I/O exige conexão criptografada).
  async bleNotifyStatus() {
    const ch = this._bleSubscriptions[0];
    if (!ch) return 'sem canal de notificação';
    try {
      const desc = await ch.getDescriptor('00002902-0000-1000-8000-00805f9b34fb');
      if (!desc) return 'sem CCCD';
      const v = await desc.readValue();
      const u8 = v instanceof Uint8Array ? v : new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength || v.buffer.byteLength);
      const flags = u8[0] || 0;
      return 'notif=' + ((flags & 1) ? 'ON' : 'OFF');
    } catch (err) {
      return 'erro CCCD: ' + ((err && err.name) || 'erro');
    }
  }

  handleBtDrop() {
    const was = this.connected;
    this.connected = false;
    this.bleChar = null;
    this.bleDevice = null;
    if (was && typeof this.onDisconnect === 'function') this.onDisconnect('bluetooth');
  }

  handleMessage(e) {
    this.processMidiBytes(Array.from(e.data || []));
  }

  processMidiBytes(bytes) {
    if (!bytes || bytes.length < 2) return;
    const type = bytes[0] & 0xf0;
    const command = this.mapMidiToCommand(type, bytes);
    if (command && typeof this.onCommand === 'function') {
      this.onCommand(command, bytes);
      return;
    }
    // Mensagens que não mapeiam para os comandos — loga para diagnóstico
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[singfy-midi] não mapeada:', bytes.map(b => b.toString(16).padStart(2, '0')).join(' '));
    }
  }

  // Tolerante a vários perfis de pedal:
  //  - CC control 0 com valor = comando (perfil SINCO/"chocolate" via USB)
  //  - CC por botão: control = comando, valor >= 64 = pressionado
  //  - Program Change: programa = comando
  //  - Note On (veloc. >= 64): nota (0-8 ou C2=36+) = comando
  mapMidiToCommand(type, bytes) {
    if (type === 0xb0) {
      const control = bytes[1];
      const value = bytes[2];
      if (control === 0 && value !== undefined) return COMMANDS[value] || null;
      if (value >= 64) return COMMANDS[control] || null;
      return null;
    }
    if (type === 0xc0) {
      return COMMANDS[bytes[1]] || null;
    }
    if (type === 0x90) {
      const note = bytes[1];
      const vel = bytes[2] || 0;
      if (vel < 64) return null;
      const idx = note <= 8 ? note : note - 36;
      if (idx >= 0) return COMMANDS[idx] || null;
      return null;
    }
    return null;
  }

  listInputs() {
    if (this.transport === 'webmidi' && this.access) {
      const out = [];
      this.access.inputs.forEach((i) => out.push(i.name));
      return out;
    }
    return this.transport === 'bluetooth' && this.bleDevice
      ? [this.bleDevice.name || 'Dispositivo BLE-MIDI']
      : [];
  }

  disconnect() {
    if (this.access) {
      this.access.inputs.forEach((inp) => {
        inp._singfyBound = false;
        inp.onmidimessage = null;
      });
      this.access.onstatechange = null;
    }
    if (this.bleDevice && this.bleDevice.gatt &&
        this.bleDevice.gatt.connected) {
      for (const ch of this._bleSubscriptions) {
        try { ch.stopNotifications(); } catch (_) {}
      }
      try { this.bleDevice.gatt.disconnect(); } catch (_) {}
    }
    this.access = null;
    this.bleDevice = null;
    this.bleChar = null;
    this._bleSubscriptions = [];
    this.connected = false;
    this.transport = null;
  }
}