export class DockerImage {
  readonly image: string;
  readonly tag: string;

  constructor(image: string, tag: string) {
    this.image = image;
    this.tag = tag;
  }

  get cliImage(): string {
    return this.image.startsWith("library/") ? this.image.slice("library/".length) : this.image;
  }

  get cliRef(): string {
    return `${this.cliImage}:${this.tag}`;
  }

  get name(): string {
    return this.image.split("/").pop() ?? this.image;
  }
}

export function splitImageTag(ref: string): { image: string; tag: string } {
  const lastSlash = ref.lastIndexOf("/");
  const lastColon = ref.lastIndexOf(":");
  if (lastColon > lastSlash) {
    return { image: ref.slice(0, lastColon), tag: ref.slice(lastColon + 1) };
  }
  return { image: ref, tag: "latest" };
}
