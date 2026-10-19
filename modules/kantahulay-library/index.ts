import { requireNativeModule } from 'expo-modules-core';

export interface PackDescriptor {
  fd: number;
  startOffset: number;
  length: number;
}

export interface LibraryModuleInterface {
  openPackFd(): PackDescriptor | null;
  closePackFd(): boolean;
  readManifest(): string | null;
  copyCatalogToTemp(destPath: string): Promise<boolean>;
  extractCatalogToCache(): Promise<string | null>;
  setScreenOrientation?(orientation: string): boolean;
}

const fallbackLibraryModule: LibraryModuleInterface = {
  openPackFd: () => null,
  closePackFd: () => false,
  readManifest: () => null,
  copyCatalogToTemp: async () => false,
  extractCatalogToCache: async () => null,
  setScreenOrientation: () => false,
};

let NativeModule: LibraryModuleInterface;
try {
  NativeModule = requireNativeModule<LibraryModuleInterface>('KantahulayLibrary');
} catch {
  NativeModule = fallbackLibraryModule;
}

export default NativeModule;
