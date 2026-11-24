export type Role = "transmitter" | "receiver";

export type Transmitter = {
  id: string;
  name: string;
  muted: boolean;
  noiseSuppression: boolean;
};

export type AudioNodes = {
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
  silentGain: GainNode;
  audio: HTMLAudioElement;
};

export type Message = {
  type: string;
  id?: string;
  name?: string;
  role?: string;
  muted?: boolean;
  noiseSuppression?: boolean;
  transmitters?: Transmitter[];
  receiverId?: string;
  senderId?: string;
  target?: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
};

export type ReceiverProfile = {
  id: string;
  name: string;
  all: boolean;
  participantNames: string[];
};
