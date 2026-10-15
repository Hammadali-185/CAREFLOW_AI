export type DatabaseProbe = {
  ping(): Promise<void>;
};
