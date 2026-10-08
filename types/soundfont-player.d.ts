declare module "soundfont-player" {
  export interface PlayOptions {
    duration?: number;
    gain?: number;
    attack?: number;
    release?: number;
  }
  export interface Instrument {
    play(note: number | string, time?: number, options?: PlayOptions): { stop: () => void } | void;
    stop?: (time?: number) => void;
    connect?: (destination: AudioNode) => void;
  }
  export interface InstrumentOptions {
    soundfont?: "FluidR3_GM" | "MusyngKite";
    format?: "mp3" | "ogg";
    destination?: AudioNode;
    nameToUrl?: (name: string, soundfont: string, format: string) => string;
  }
  const Soundfont: {
    instrument(ctx: AudioContext, name: string, options?: InstrumentOptions): Promise<Instrument>;
  };
  export default Soundfont;
}
