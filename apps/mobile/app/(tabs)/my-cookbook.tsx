import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type RecipeView } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useUiStore } from "@/lib/ui-store";
import {
  AlchemyField,
  AlchemyButton,
  AlchemySearchInput,
  AlchemyFilterRow,
  AlchemyRecipeCard
} from "@/components/alchemy/primitives";
import { alchemyColors, alchemyRadius, alchemySpacing, alchemyTypography } from "@/components/alchemy/theme";

// ─── Nutrition widget ──────────────────────────────────────────────────────────

type NutritionWidgetProps = {
  calories?: number;
  totalMinutes?: number;
  carbsG?: number;
  proteinG?: number;
  fatG?: number;
};


function NutritionWidget({ calories, totalMinutes, carbsG, proteinG, fatG }: NutritionWidgetProps) {
  const total = (carbsG ?? 0) + (proteinG ?? 0) + (fatG ?? 0);
  const carbsPct = total > 0 ? Math.round(((carbsG ?? 0) / total) * 100) : 0;
  const proteinPct = total > 0 ? Math.round(((proteinG ?? 0) / total) * 100) : 0;
  const fatPct = total > 0 ? Math.round(((fatG ?? 0) / total) * 100) : 0;

  const macros = [
    { label: "Net Carbs", pct: carbsPct, color: "#A78BFA" },
    { label: "Protein", pct: proteinPct, color: "#34D399" },
    { label: "Fat", pct: fatPct, color: "#FB923C" }
  ];

  return (
    <View style={nutriStyles.wrap}>
      {/* Time + calories row */}
      {(totalMinutes !== undefined || calories !== undefined) && (
        <View style={nutriStyles.statsRow}>
          {totalMinutes !== undefined && (
            <View style={nutriStyles.stat}>
              <Text style={nutriStyles.statIcon}>⏱</Text>
              <Text style={nutriStyles.statValue}>{totalMinutes} min</Text>
            </View>
          )}
          {calories !== undefined && (
            <View style={nutriStyles.stat}>
              <Text style={nutriStyles.statIcon}>🔥</Text>
              <Text style={nutriStyles.statValue}>{calories} kcal</Text>
            </View>
          )}
        </View>
      )}

      {/* Macro rings */}
      {total > 0 && (
        <View style={nutriStyles.macroRow}>
          {macros.map((macro) => (
            <View key={macro.label} style={nutriStyles.macroItem}>
              <MacroRing pct={macro.pct} color={macro.color} />
              <Text style={nutriStyles.macroPct}>{macro.pct}%</Text>
              <Text style={nutriStyles.macroLabel}>{macro.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function MacroRing({ pct, color, size = 56 }: { pct: number; color: string; size?: number }) {
  const stroke = 5;
  const inner = size - stroke * 2;
  const filled = Math.max(0, Math.min(100, pct));
  // Quadrant coloring: fill top/right/bottom/left borders based on percentage
  const q1 = filled >= 25; // 0–25%  → right border
  const q2 = filled >= 50; // 25–50% → bottom border
  const q3 = filled >= 75; // 50–75% → left border
  const q4 = filled >= 100; // 75–100% → top border
  // Rotation for partial fill in the active quadrant
  const baseAngle = Math.floor(filled / 25) * 90;
  const partialPct = (filled % 25) / 25;
  const partialAngle = baseAngle + partialPct * 90;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* Track */}
      <View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: stroke,
          borderColor: "rgba(255,255,255,0.1)"
        }}
      />
      {/* Full quadrants */}
      <View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: stroke,
          borderTopColor: q4 ? color : "transparent",
          borderRightColor: q1 ? color : "transparent",
          borderBottomColor: q2 ? color : "transparent",
          borderLeftColor: q3 ? color : "transparent"
        }}
      />
      {/* Partial fill overlay rotated */}
      {filled > 0 && filled < 100 && (
        <View
          style={{
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: stroke,
            borderTopColor: "transparent",
            borderRightColor: color,
            borderBottomColor: "transparent",
            borderLeftColor: "transparent",
            transform: [{ rotate: `${partialAngle - 90}deg` }]
          }}
        />
      )}
      {/* Center hole */}
      <View
        style={{
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          backgroundColor: alchemyColors.dark
        }}
      />
    </View>
  );
}

const nutriStyles = StyleSheet.create({
  wrap: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: alchemyRadius.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: alchemySpacing.md,
    gap: 14
  },
  statsRow: {
    flexDirection: "row",
    gap: 20
  },
  stat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  statIcon: {
    fontSize: 14
  },
  statValue: {
    ...alchemyTypography.captionLight,
    color: alchemyColors.grey4
  },
  macroRow: {
    flexDirection: "row",
    justifyContent: "space-around"
  },
  macroItem: {
    alignItems: "center",
    gap: 6
  },
  macroPct: {
    ...alchemyTypography.caption,
    color: alchemyColors.grey4,
    marginTop: 2
  },
  macroLabel: {
    ...alchemyTypography.micro,
    color: alchemyColors.grey1,
    letterSpacing: 0.3
  }
});

// ─── Ingredient row ────────────────────────────────────────────────────────────

function IngredientRow({ amount, unit, name, preparation }: {
  amount?: number | string;
  unit?: string;
  name: string;
  preparation?: string;
}) {
  const measure = [amount !== undefined ? String(amount) : "", unit ?? ""].filter(Boolean).join(" ");
  const label = preparation ? `${name}, ${preparation}` : name;
  return (
    <View style={ingStyles.row}>
      <Text style={ingStyles.measure}>{measure}</Text>
      <Text style={ingStyles.name}>{label}</Text>
    </View>
  );
}

const ingStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 12,
    marginBottom: 9
  },
  measure: {
    ...alchemyTypography.captionLight,
    color: alchemyColors.grey1,
    width: 68,
    textAlign: "right",
    flexShrink: 0
  },
  name: {
    ...alchemyTypography.captionLight,
    color: alchemyColors.grey4,
    flex: 1
  }
});

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function MyCookbookScreen(): React.JSX.Element {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const query = useQuery({
    queryKey: ["recipes", "cookbook"],
    queryFn: () => api.getCookbook(),
    enabled: isAuthenticated
  });

  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [overrideCategory, setOverrideCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  const detailQuery = useQuery({
    queryKey: ["recipes", selectedRecipeId],
    queryFn: () => api.getRecipe(selectedRecipeId ?? ""),
    enabled: Boolean(selectedRecipeId)
  });

  const historyQuery = useQuery({
    queryKey: ["recipes", selectedRecipeId, "history"],
    queryFn: () => api.getRecipeHistory(selectedRecipeId ?? ""),
    enabled: Boolean(selectedRecipeId)
  });

  const overrideMutation = useMutation({
    mutationFn: async ({ recipeId, category }: { recipeId: string; category: string }) => {
      return api.setCategoryOverride(recipeId, category);
    },
    onSuccess: () => {
      setOverrideCategory("");
      void query.refetch();
    }
  });

  const { inlineMeasurements } = useUiStore();

  if (!isAuthenticated) {
    return <Redirect href="/sign-in" />;
  }

  const cookbookItems = query.data?.items ?? [];

  // Build category list from items
  const categoryOptions = useMemo(() => {
    const cats = new Set<string>();
    for (const item of cookbookItems) {
      cats.add(item.category ?? "Uncategorized");
    }
    return ["All", ...Array.from(cats)];
  }, [cookbookItems]);

  // Filter items
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return cookbookItems.filter((item) => {
      if (selectedCategory !== "All" && (item.category ?? "Uncategorized") !== selectedCategory) return false;
      if (q.length === 0) return true;
      return item.title.toLowerCase().includes(q) || (item.summary ?? "").toLowerCase().includes(q);
    });
  }, [cookbookItems, searchQuery, selectedCategory]);

  // Split into two columns for staggered grid
  const [colA, colB] = useMemo(() => {
    const a: typeof filteredItems = [];
    const b: typeof filteredItems = [];
    filteredItems.forEach((item, i) => {
      if (i % 2 === 0) a.push(item);
      else b.push(item);
    });
    return [a, b];
  }, [filteredItems]);

  const selectedRecipe: RecipeView | undefined = detailQuery.data;
  const tabBarClearance = insets.bottom + 88;

  const openRecipe = (id: string) => {
    setSelectedRecipeId(id);
    setOverrideCategory("");
  };

  const closeModal = () => setSelectedRecipeId(null);

  return (
    <View style={styles.root}>
      {/* Background */}
      <LinearGradient
        colors={[alchemyColors.deepDark, "rgba(6,15,26,0.96)"]}
        style={StyleSheet.absoluteFillObject}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 20, paddingBottom: tabBarClearance + 16 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={alchemyColors.grey1}
          />
        }
      >
        {/* Header */}
        <Text style={styles.headerTitle}>Cookbook</Text>
        <Text style={styles.headerSub}>
          {cookbookItems.length > 0
            ? `${cookbookItems.length} saved recipe${cookbookItems.length !== 1 ? "s" : ""}`
            : "Your saved recipes will appear here"}
        </Text>

        {/* Search */}
        <AlchemySearchInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search recipes"
          style={styles.search}
        />

        {/* Category filter */}
        {categoryOptions.length > 2 && (
          <AlchemyFilterRow
            options={categoryOptions}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
            style={styles.filterRow}
          />
        )}

        {/* States */}
        {query.isPending ? (
          <View style={styles.stateWrap}>
            <ActivityIndicator color={alchemyColors.grey1} />
            <Text style={styles.stateText}>Loading your cookbook...</Text>
          </View>
        ) : query.isError ? (
          <View style={styles.stateWrap}>
            <Text style={styles.errorText}>Could not load cookbook</Text>
            <Text style={styles.stateText}>Pull to refresh or try again shortly.</Text>
          </View>
        ) : filteredItems.length === 0 ? (
          <View style={styles.stateWrap}>
            <Text style={styles.emptyTitle}>
              {cookbookItems.length === 0 ? "Nothing saved yet" : "No matching recipes"}
            </Text>
            <Text style={styles.stateText}>
              {cookbookItems.length === 0
                ? "Generate and save recipes to start building your cookbook."
                : "Try a different search or category."}
            </Text>
          </View>
        ) : (
          // 2-column staggered grid
          <View style={styles.grid}>
            <View style={styles.col}>
              {colA.map((item) => (
                <AlchemyRecipeCard
                  key={item.id}
                  imageUri={item.image_url}
                  title={item.title}
                  subtitle={item.summary}
                  onPress={() => openRecipe(item.id)}
                  style={styles.card}
                />
              ))}
            </View>
            <View style={[styles.col, styles.colOffset]}>
              {colB.map((item) => (
                <AlchemyRecipeCard
                  key={item.id}
                  imageUri={item.image_url}
                  title={item.title}
                  subtitle={item.summary}
                  onPress={() => openRecipe(item.id)}
                  style={styles.card}
                />
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Recipe detail modal ── */}
      <Modal
        transparent
        visible={selectedRecipeId !== null}
        animationType="slide"
        onRequestClose={closeModal}
        statusBarTranslucent={Platform.OS === "android"}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalDismiss} onPress={closeModal} />

          <View style={styles.modalSheet}>
            {/* Handle bar */}
            <View style={styles.modalHandleWrap}>
              <View style={styles.modalHandle} />
            </View>

            {detailQuery.isPending ? (
              <View style={styles.modalStateWrap}>
                <ActivityIndicator color={alchemyColors.grey1} />
                <Text style={styles.stateText}>Loading recipe...</Text>
              </View>
            ) : detailQuery.isError || !selectedRecipe ? (
              <View style={styles.modalStateWrap}>
                <Text style={styles.errorText}>Could not load recipe</Text>
                <Pressable onPress={closeModal} style={styles.closeBtn}>
                  <Text style={styles.closeBtnText}>Close</Text>
                </Pressable>
              </View>
            ) : (
              <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={[styles.modalContent, { paddingBottom: insets.bottom + 32 }]}
                showsVerticalScrollIndicator={false}
              >
                {/* Hero image */}
                {selectedRecipe.image_url ? (
                  <View style={styles.modalHero}>
                    <Image
                      source={selectedRecipe.image_url}
                      contentFit="cover"
                      style={StyleSheet.absoluteFillObject}
                      transition={300}
                    />
                    <LinearGradient
                      colors={["transparent", alchemyColors.dark]}
                      locations={[0.5, 1]}
                      style={StyleSheet.absoluteFillObject}
                    />
                  </View>
                ) : null}

                {/* Title + meta */}
                <Text style={styles.detailTitle}>{selectedRecipe.title}</Text>
                {selectedRecipe.summary ? (
                  <Text style={styles.detailSummary}>{selectedRecipe.summary}</Text>
                ) : null}

                <View style={styles.detailMetaRow}>
                  {selectedRecipe.servings > 0 ? (
                    <Text style={styles.detailMeta}>Serves {selectedRecipe.servings}</Text>
                  ) : null}
                  {selectedRecipe.metadata?.difficulty ? (
                    <Text style={styles.detailMeta}>{selectedRecipe.metadata.difficulty}</Text>
                  ) : null}
                </View>

                {/* Nutrition widget */}
                {(selectedRecipe.metadata?.nutrition ?? selectedRecipe.metadata?.timing) ? (
                  <NutritionWidget
                    calories={selectedRecipe.metadata?.nutrition?.calories}
                    totalMinutes={selectedRecipe.metadata?.timing?.total_minutes}
                    carbsG={selectedRecipe.metadata?.nutrition?.carbs_g}
                    proteinG={selectedRecipe.metadata?.nutrition?.protein_g}
                    fatG={selectedRecipe.metadata?.nutrition?.fat_g}
                  />
                ) : null}

                {/* Ingredients */}
                <Text style={styles.sectionLabel}>Ingredients</Text>
                {selectedRecipe.ingredients.map((ing, i) => (
                  <IngredientRow
                    key={`${ing.name}-${i}`}
                    amount={ing.amount}
                    unit={ing.unit}
                    name={ing.name}
                    preparation={ing.preparation}
                  />
                ))}

                {/* Method */}
                <Text style={styles.sectionLabel}>Method</Text>
                {selectedRecipe.steps.map((step, idx) => (
                  <View key={`step-${step.index}-${idx}`} style={styles.stepRow}>
                    <Text style={styles.stepNum}>{step.index}</Text>
                    <View style={styles.stepBody}>
                      <Text style={styles.stepText}>{step.instruction}</Text>
                      {inlineMeasurements && step.inline_measurements && step.inline_measurements.length > 0 ? (
                        <Text style={styles.stepInline}>
                          {step.inline_measurements.map((m) => `${m.amount} ${m.unit} ${m.ingredient}`).join(" · ")}
                        </Text>
                      ) : null}
                      {step.notes ? <Text style={styles.stepInline}>{step.notes}</Text> : null}
                    </View>
                  </View>
                ))}

                {/* Notes */}
                {selectedRecipe.notes ? (
                  <>
                    <Text style={styles.sectionLabel}>Notes</Text>
                    <Text style={styles.notesText}>{selectedRecipe.notes}</Text>
                  </>
                ) : null}

                {/* Pairings */}
                {selectedRecipe.pairings && selectedRecipe.pairings.length > 0 ? (
                  <>
                    <Text style={styles.sectionLabel}>Pairings</Text>
                    {selectedRecipe.pairings.map((p, i) => (
                      <Text key={i} style={styles.pairingLine}>· {p}</Text>
                    ))}
                  </>
                ) : null}

                {/* Category override */}
                <Text style={styles.sectionLabel}>Category</Text>
                <View style={styles.overrideRow}>
                  <AlchemyField
                    value={overrideCategory}
                    onChangeText={setOverrideCategory}
                    placeholder={selectedRecipe.category ?? "Override category…"}
                    style={{ flex: 1 }}
                  />
                  <Pressable
                    style={[styles.overrideBtn, (!overrideCategory.trim() || overrideMutation.isPending) && styles.overrideBtnDisabled]}
                    disabled={!overrideCategory.trim() || overrideMutation.isPending}
                    onPress={() => {
                      if (!selectedRecipeId || !overrideCategory.trim()) return;
                      overrideMutation.mutate({ recipeId: selectedRecipeId, category: overrideCategory.trim() });
                    }}
                  >
                    <Text style={styles.overrideBtnText}>Set</Text>
                  </Pressable>
                </View>

                {/* History */}
                {historyQuery.data?.versions && historyQuery.data.versions.length > 0 ? (
                  <>
                    <Text style={styles.sectionLabel}>History</Text>
                    {historyQuery.data.versions.map((v) => (
                      <Text key={v.id} style={styles.historyLine}>
                        {new Date(v.created_at).toLocaleDateString()} — {v.diff_summary ?? "version"}
                      </Text>
                    ))}
                  </>
                ) : null}

                {/* Actions */}
                <View style={styles.actionsWrap}>
                  <AlchemyButton
                    label="Tweak with Alchemy"
                    onPress={() => {
                      closeModal();
                      router.push({
                        pathname: "/(tabs)/generate",
                        params: { recipeId: selectedRecipeId ?? "" }
                      });
                    }}
                  />
                  <Pressable onPress={closeModal} style={styles.closeLink}>
                    <Text style={styles.closeLinkText}>Close</Text>
                  </Pressable>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: alchemyColors.deepDark
  },
  scroll: {
    flex: 1
  },
  scrollContent: {
    paddingHorizontal: alchemySpacing.md,
    gap: 0
  },

  // Header
  headerTitle: {
    ...alchemyTypography.titleXL,
    color: alchemyColors.white,
    marginBottom: 6
  },
  headerSub: {
    ...alchemyTypography.bodySmall,
    color: alchemyColors.grey1,
    marginBottom: alchemySpacing.lg
  },
  search: {
    marginBottom: alchemySpacing.sm2
  },
  filterRow: {
    marginBottom: alchemySpacing.lg
  },

  // States
  stateWrap: {
    paddingTop: 48,
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20
  },
  stateText: {
    ...alchemyTypography.bodySmall,
    color: alchemyColors.grey1,
    textAlign: "center"
  },
  errorText: {
    ...alchemyTypography.caption,
    color: alchemyColors.danger
  },
  emptyTitle: {
    ...alchemyTypography.bodyBold,
    color: alchemyColors.grey4
  },

  // Grid
  grid: {
    flexDirection: "row",
    gap: 10
  },
  col: {
    flex: 1,
    gap: 10
  },
  colOffset: {
    marginTop: 32
  },
  card: {
    aspectRatio: 0.78
  },

  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(2,6,23,0.6)"
  },
  modalDismiss: {
    flex: 1
  },
  modalSheet: {
    height: "88%",
    borderTopLeftRadius: alchemyRadius.xl,
    borderTopRightRadius: alchemyRadius.xl,
    backgroundColor: alchemyColors.dark,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden"
  },
  modalHandleWrap: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 6
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.22)"
  },
  modalStateWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12
  },
  closeBtn: {
    paddingHorizontal: alchemySpacing.md,
    paddingVertical: 10,
    borderRadius: alchemyRadius.sm,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)"
  },
  closeBtnText: {
    ...alchemyTypography.caption,
    color: alchemyColors.grey4
  },
  modalScroll: {
    flex: 1
  },
  modalContent: {
    gap: alchemySpacing.md,
    paddingHorizontal: alchemySpacing.md
  },

  // Modal hero
  modalHero: {
    height: 220,
    borderRadius: alchemyRadius.lg,
    overflow: "hidden",
    backgroundColor: alchemyColors.deepDark,
    marginBottom: 4
  },

  // Detail content
  detailTitle: {
    ...alchemyTypography.titleXL,
    color: alchemyColors.white
  },
  detailSummary: {
    ...alchemyTypography.bodySmall,
    color: "rgba(255,255,255,0.72)",
    lineHeight: 22
  },
  detailMetaRow: {
    flexDirection: "row",
    gap: 16,
    flexWrap: "wrap"
  },
  detailMeta: {
    ...alchemyTypography.captionLight,
    color: alchemyColors.grey1,
    letterSpacing: 0.3
  },
  sectionLabel: {
    ...alchemyTypography.caption,
    color: alchemyColors.grey2,
    letterSpacing: 0.8,
    marginTop: 6
  },

  // Steps
  stepRow: {
    flexDirection: "row",
    gap: 14,
    alignItems: "flex-start"
  },
  stepNum: {
    ...alchemyTypography.caption,
    color: alchemyColors.grey2,
    width: 20,
    textAlign: "right",
    paddingTop: 1,
    lineHeight: 21
  },
  stepBody: {
    flex: 1,
    gap: 4
  },
  stepText: {
    ...alchemyTypography.captionLight,
    color: alchemyColors.grey4,
    lineHeight: 22
  },
  stepInline: {
    ...alchemyTypography.micro,
    color: alchemyColors.grey1
  },

  // Notes + pairings
  notesText: {
    ...alchemyTypography.bodySmall,
    color: alchemyColors.grey2,
    lineHeight: 22
  },
  pairingLine: {
    ...alchemyTypography.captionLight,
    color: alchemyColors.grey2
  },

  // History
  historyLine: {
    ...alchemyTypography.micro,
    color: alchemyColors.grey1,
    lineHeight: 18
  },

  // Category override
  overrideRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  overrideBtn: {
    height: 64,
    paddingHorizontal: alchemySpacing.md,
    borderRadius: alchemyRadius.sm,
    backgroundColor: alchemyColors.dark,
    borderWidth: 2,
    borderColor: alchemyColors.dark,
    alignItems: "center",
    justifyContent: "center"
  },
  overrideBtnDisabled: {
    opacity: 0.38
  },
  overrideBtnText: {
    ...alchemyTypography.caption,
    color: alchemyColors.grey4
  },

  // Actions
  actionsWrap: {
    gap: 12,
    marginTop: 8
  },
  closeLink: {
    alignItems: "center",
    paddingVertical: 14
  },
  closeLinkText: {
    ...alchemyTypography.captionLight,
    color: alchemyColors.grey1
  }
});
