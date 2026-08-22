export type SoundCategory = "sfx" | "music" | "voices" | string;
export type LocalizedSoundSources = Record<string, string>;
export type SoundSource = string | string[] | LocalizedSoundSources;

export interface SoundDefinitionObject {
    src: SoundSource;
    category?: SoundCategory;
}

export type SoundDefinition = string | SoundDefinitionObject;
export type SoundFiles = Record<string, SoundDefinition>;
