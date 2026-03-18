import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Image,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@stores/index';
import { listAnime, searchAnime, addAnimeToList } from '@features/anime/anime.service';
import { COLORS } from '@constants/colors';
import type { Database } from '@app-types/database';

type AnimeRow = Database['public']['Tables']['anime']['Row'];

const MIN_ANIME = 2; // Minimum needed to do battles
const RECOMMEND_ANIME = 5;

// ---------------------------------------------------------------------------
// Step identifiers
// ---------------------------------------------------------------------------
type Step = 'welcome' | 'pick-anime';

// ---------------------------------------------------------------------------
// Anime card used in the picker
// ---------------------------------------------------------------------------
function AnimeCard({
  anime,
  selected,
  onToggle,
}: {
  anime: AnimeRow;
  selected: boolean;
  onToggle: () => void;
}) {
  // Prefer higher-quality cover images; fall back to legacy poster field
  const imageUri =
    anime.cover_image_medium ?? anime.cover_image_large ?? anime.poster ?? null;

  // Prefer English title, fall back to romaji, then the generic title column
  const displayTitle =
    anime.title_english ?? anime.title_romaji ?? anime.title;

  // Build a concise meta string: format · year · N eps
  const year = anime.season_year ?? anime.release_year;
  const fmt  = anime.format ?? (anime.type === 'movie' ? 'MOVIE' : 'TV');
  // franchise_episode_total is the sum across all seasons; fall back to the
  // per-row episode count for standalone entries that have no sequels.
  const eps  = anime.franchise_episode_total ?? anime.episodes ?? anime.episode_count;
  const meta = [
    fmt,
    year,
    eps ? `${eps} eps` : null,
  ].filter(Boolean).join(' · ');

  return (
    <TouchableOpacity
      style={[styles.animeCard, selected && styles.animeCardSelected]}
      onPress={onToggle}
      activeOpacity={0.75}
    >
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={styles.animePoster}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.animePoster, styles.animePosterPlaceholder]}>
          <Text style={styles.animePosterPlaceholderText}>
            {displayTitle.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.animeInfo}>
        <Text style={styles.animeTitle} numberOfLines={2}>
          {displayTitle}
        </Text>
        <Text style={styles.animeMeta}>{meta}</Text>
      </View>
      <View style={[styles.checkCircle, selected && styles.checkCircleSelected]}>
        {selected && <Text style={styles.checkMark}>✓</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Main onboarding screen
// ---------------------------------------------------------------------------
export default function OnboardingScreen() {
  const { user, setHasCompletedOnboarding } = useAuthStore();

  const [step, setStep] = useState<Step>('welcome');

  // Anime picker state
  const [catalogue, setCatalogue] = useState<AnimeRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AnimeRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingCatalogue, setIsLoadingCatalogue] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load the catalogue when entering the anime step
  useEffect(() => {
    if (step === 'pick-anime') {
      loadCatalogue();
    }
  }, [step]);

  async function loadCatalogue() {
    setIsLoadingCatalogue(true);
    try {
      const data = await listAnime(0, 50);
      setCatalogue(data);
    } catch {
      // If loading fails, catalogue stays empty; user can still search
    } finally {
      setIsLoadingCatalogue(false);
    }
  }

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchAnime(searchQuery.trim(), 30);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  function toggleAnime(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleComplete() {
    if (!user?.id) return;
    if (selected.size < MIN_ANIME) return;

    setSaveError(null);
    setIsSaving(true);

    try {
      // Add all selected anime to the user's list sequentially.
      // Each insert triggers the DB to create a user_rankings row at Elo 1500.
      await Promise.all(
        Array.from(selected).map((animeId) =>
          addAnimeToList(user.id, animeId, 'plan_to_watch'),
        ),
      );

      // Mark onboarding as done in the store
      setHasCompletedOnboarding(true);

      // Navigate to main app
      router.replace('/(tabs)/battles');
    } catch (e: any) {
      setSaveError(e?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Step: Welcome
  // ---------------------------------------------------------------------------
  if (step === 'welcome') {
    const displayName =
      user?.user_metadata?.username ?? user?.email?.split('@')[0] ?? 'there';

    return (
      <View style={styles.root}>
        <View style={styles.welcomeContainer}>
          <Text style={styles.welcomeEmoji}>👋</Text>
          <Text style={styles.welcomeTitle}>Hey, {displayName}!</Text>
          <Text style={styles.welcomeBody}>
            AniRank helps you rank every anime you've ever watched using head-to-head
            matchups. The more you battle, the smarter your ranking gets.
          </Text>
          <Text style={styles.welcomeBodySmall}>
            To get started, pick at least {RECOMMEND_ANIME} anime from your watch
            history — you can always add more later.
          </Text>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => setStep('pick-anime')}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Pick My Anime →</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Step: Pick anime
  // ---------------------------------------------------------------------------
  const displayList = searchQuery.trim() ? searchResults : catalogue;
  const hasEnough = selected.size >= MIN_ANIME;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.pickerHeader}>
        <Text style={styles.pickerTitle}>Select your anime</Text>
        <Text style={styles.pickerSubtitle}>
          {selected.size > 0
            ? `${selected.size} selected${selected.size < MIN_ANIME ? ` (need ${MIN_ANIME - selected.size} more)` : ''}`
            : `Choose at least ${MIN_ANIME} to continue`}
        </Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by title…"
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {isSearching && (
          <ActivityIndicator
            size="small"
            color={COLORS.primary}
            style={styles.searchSpinner}
          />
        )}
      </View>

      {/* List */}
      {isLoadingCatalogue ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : displayList.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            {searchQuery.trim()
              ? 'No results found. Try a different title.'
              : 'No anime in the catalogue yet.\nYou can come back and add more later.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayList}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <AnimeCard
              anime={item}
              selected={selected.has(item.id)}
              onToggle={() => toggleAnime(item.id)}
            />
          )}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {/* Save error */}
      {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}

      {/* Footer CTA */}
      <View style={styles.pickerFooter}>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            styles.primaryButtonFull,
            (!hasEnough || isSaving) && styles.primaryButtonDisabled,
          ]}
          onPress={handleComplete}
          disabled={!hasEnough || isSaving}
          activeOpacity={0.8}
        >
          {isSaving ? (
            <ActivityIndicator color={COLORS.background} size="small" />
          ) : (
            <Text style={styles.primaryButtonText}>
              {hasEnough
                ? `Start ranking with ${selected.size} anime →`
                : `Select ${MIN_ANIME - selected.size} more to continue`}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  // Welcome step
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 48,
  },
  welcomeEmoji: {
    fontSize: 52,
    marginBottom: 20,
    textAlign: 'center',
  },
  welcomeTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: -0.5,
  },
  welcomeBody: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 16,
  },
  welcomeBodySmall: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 48,
  },

  // Buttons
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  primaryButtonFull: {
    width: '100%',
  },
  primaryButtonDisabled: {
    opacity: 0.45,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },

  // Anime picker header
  pickerHeader: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  pickerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  pickerSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },

  // Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.text,
  },
  searchSpinner: {
    marginLeft: 8,
  },

  // List
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },

  // Anime card
  animeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    marginBottom: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  animeCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surfaceElevated,
  },
  animePoster: {
    width: 52,
    height: 72,
    borderRadius: 6,
    marginRight: 12,
  },
  animePosterPlaceholder: {
    backgroundColor: COLORS.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  animePosterPlaceholderText: {
    color: COLORS.primary,
    fontSize: 20,
    fontWeight: '700',
  },
  animeInfo: {
    flex: 1,
  },
  animeTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
    lineHeight: 20,
  },
  animeMeta: {
    fontSize: 12,
    color: COLORS.textMuted,
    textTransform: 'capitalize',
  },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  checkCircleSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkMark: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },

  // Footer
  pickerFooter: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  saveError: {
    color: COLORS.error,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
});
