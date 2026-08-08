export type GeneralTimerTickerRequest =
  | {
      type: "start";
      intervalMs: number;
    }
  | {
      type: "stop";
    };

export type GeneralTimerTickerResponse = {
  type: "tick";
  now: number;
};
