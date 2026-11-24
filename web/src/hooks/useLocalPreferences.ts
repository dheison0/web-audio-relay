import { useEffect, useState } from "react";
import type { ReceiverProfile, Role, Transmitter } from "../types";

const PROFILE_STORAGE_KEY = "audio-relay.receiver-profiles";
const NAME_STORAGE_KEY = "audio-relay.nickname";
const ROLE_STORAGE_KEY = "audio-relay.role";
const ALL_PROFILE: ReceiverProfile = {
  id: "all",
  name: "Todos",
  all: true,
  participantNames: [],
};

type StoredProfiles = {
  profiles: ReceiverProfile[];
  activeProfileId: string;
};

function isReceiverProfile(value: unknown): value is ReceiverProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<ReceiverProfile>;
  return (
    typeof profile.id === "string" &&
    profile.id.length > 0 &&
    typeof profile.name === "string" &&
    profile.name.trim().length > 0 &&
    typeof profile.all === "boolean" &&
    Array.isArray(profile.participantNames) &&
    profile.participantNames.every((name) => typeof name === "string")
  );
}

function loadStoredProfiles(): StoredProfiles {
  const stored = localStorage.getItem(PROFILE_STORAGE_KEY);
  if (!stored) return { profiles: [ALL_PROFILE], activeProfileId: ALL_PROFILE.id };

  const parsed: unknown = JSON.parse(stored);
  if (!parsed || typeof parsed !== "object") throw new Error("Formato de perfis inválido.");
  const value = parsed as Partial<StoredProfiles>;
  if (
    !Array.isArray(value.profiles) ||
    !value.profiles.every(isReceiverProfile) ||
    typeof value.activeProfileId !== "string"
  ) {
    throw new Error("Formato de perfis inválido.");
  }
  const customProfiles = value.profiles.filter(
    (profile) => profile.id !== ALL_PROFILE.id && !profile.all,
  );
  const profileIds = new Set<string>();
  const profileNames = new Set<string>();
  for (const profile of customProfiles) {
    const normalizedName = profile.name.trim().toLocaleLowerCase();
    if (profileIds.has(profile.id) || profileNames.has(normalizedName)) {
      throw new Error("Os perfis salvos contêm identificadores ou nomes repetidos.");
    }
    profileIds.add(profile.id);
    profileNames.add(normalizedName);
  }
  const profiles = [ALL_PROFILE, ...customProfiles];
  const activeProfileId = profiles.some((profile) => profile.id === value.activeProfileId)
    ? value.activeProfileId
    : ALL_PROFILE.id;
  return { profiles, activeProfileId };
}

function useInitialProfiles(): [StoredProfiles, string | null] {
  try {
    return [loadStoredProfiles(), null];
  } catch (error) {
    console.error("Não foi possível carregar perfis de reprodução salvos:", error);
    return [
      { profiles: [ALL_PROFILE], activeProfileId: ALL_PROFILE.id },
      "Não foi possível carregar os perfis salvos. Um perfil Todos foi carregado.",
    ];
  }
}

export function useLocalProfiles(transmitters: Transmitter[]) {
  const [initialState] = useState(useInitialProfiles);
  const [initialProfiles, initialError] = initialState;
  const [profiles, setProfiles] = useState(initialProfiles.profiles);
  const [activeProfileId, setActiveProfileId] = useState(initialProfiles.activeProfileId);
  const [storageError, setStorageError] = useState<string | null>(null);
  const activeProfile =
    profiles.find((profile) => profile.id === activeProfileId) ?? ALL_PROFILE;

  useEffect(() => {
    try {
      localStorage.setItem(
        PROFILE_STORAGE_KEY,
        JSON.stringify({ profiles, activeProfileId }),
      );
      setStorageError(null);
    } catch (error) {
      console.error("Não foi possível salvar perfis de reprodução:", error);
      setStorageError("Não foi possível salvar os perfis neste navegador.");
    }
  }, [profiles, activeProfileId]);

  const createProfile = (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return "Informe um nome para o perfil.";
    if (profiles.some((profile) => profile.name.trim().toLocaleLowerCase() === trimmedName.toLocaleLowerCase())) {
      return "Já existe um perfil com esse nome.";
    }
    const selectedNames = activeProfile.all
      ? transmitters.map((transmitter) => transmitter.name)
      : activeProfile.participantNames;
    const profile: ReceiverProfile = {
      id: crypto.randomUUID(),
      name: trimmedName,
      all: false,
      participantNames: [...new Set(selectedNames)],
    };
    setProfiles((current) => [...current, profile]);
    setActiveProfileId(profile.id);
    return null;
  };

  const deleteProfile = (profileId: string) => {
    if (profileId === ALL_PROFILE.id) return;
    setProfiles((current) => current.filter((profile) => profile.id !== profileId));
    if (activeProfileId === profileId) setActiveProfileId(ALL_PROFILE.id);
  };

  const toggleParticipant = (participantName: string) => {
    if (activeProfile.all) return;
    setProfiles((current) =>
      current.map((profile) => {
        if (profile.id !== activeProfileId) return profile;
        const selected = profile.participantNames.includes(participantName);
        return {
          ...profile,
          participantNames: selected
            ? profile.participantNames.filter((name) => name !== participantName)
            : [...profile.participantNames, participantName],
        };
      }),
    );
  };

  const includesParticipant = (name: string) =>
    activeProfile.all || activeProfile.participantNames.includes(name);

  return {
    profiles,
    activeProfile,
    activeProfileId,
    setActiveProfileId,
    createProfile,
    deleteProfile,
    toggleParticipant,
    includesParticipant,
    storageError: initialError ?? storageError,
  };
}

export function useStoredNickname() {
  const [nickname, setNickname] = useState(() => {
    try {
      return localStorage.getItem(NAME_STORAGE_KEY) ?? "";
    } catch (error) {
      console.error("Não foi possível ler o apelido salvo:", error);
      return "";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(NAME_STORAGE_KEY, nickname);
    } catch (error) {
      console.error("Não foi possível salvar o apelido:", error);
    }
  }, [nickname]);

  return [nickname, setNickname] as const;
}

export function useStoredRole() {
  const [role, setRole] = useState<Role>(() => {
    try {
      const storedRole = localStorage.getItem(ROLE_STORAGE_KEY);
      return storedRole === "receiver" || storedRole === "transmitter"
        ? storedRole
        : "transmitter";
    } catch (error) {
      console.error("Não foi possível ler o modo salvo:", error);
      return "transmitter";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(ROLE_STORAGE_KEY, role);
    } catch (error) {
      console.error("Não foi possível salvar o modo:", error);
    }
  }, [role]);

  return [role, setRole] as const;
}
