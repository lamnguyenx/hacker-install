import type { InstallMethod, PackageType, ReleaseAsset } from "../../schemas.ts";

export interface Release {
  source: string;
  name: string;
  tagName: string;
  prerelease: boolean;
  publishedAt: string;
  assets: ReleaseAsset[];
  description: string;
  packageType?: PackageType;
  installMethod?: InstallMethod;
  packageName?: string;
}
