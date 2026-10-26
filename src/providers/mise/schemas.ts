export interface AquaAsset {
  url: string;
  name: string;
  version: string;
  fmt: string;
  owner: string;
  repo: string;
  description: string;
}

export interface MiseToolInfo {
  owner: string;
  repo: string;
  aquaPath: string;
  description: string;
  versionSource: string;
}
