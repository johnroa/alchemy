import { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from "react-native";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Section = {
  title: string;
  data: Array<{ id: string; title: string; summary: string; image_url?: string }>;
};

export default function MyCookbookScreen(): React.JSX.Element {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: ["recipes", "cookbook"],
    queryFn: () => api.getCookbook(),
    enabled: isAuthenticated
  });
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [overrideCategory, setOverrideCategory] = useState("");

  const overrideMutation = useMutation({
    mutationFn: async ({ recipeId, category }: { recipeId: string; category: string }) => {
      return api.setCategoryOverride(recipeId, category);
    },
    onSuccess: () => {
      setSelectedRecipeId(null);
      setOverrideCategory("");
      void query.refetch();
    }
  });

  const sections = useMemo<Section[]>(() => {
    const byCategory = new Map<string, Array<{ id: string; title: string; summary: string; image_url?: string }>>();
    for (const recipe of query.data?.items ?? []) {
      const category = recipe.category ?? "Auto Organized";
      const existing = byCategory.get(category) ?? [];
      const nextItem: { id: string; title: string; summary: string; image_url?: string } = {
        id: recipe.id,
        title: recipe.title,
        summary: recipe.summary
      };
      if (recipe.image_url) {
        nextItem.image_url = recipe.image_url;
      }
      existing.push(nextItem);
      byCategory.set(category, existing);
    }

    return Array.from(byCategory.entries()).map(([title, data]) => ({ title, data }));
  }, [query.data]);

  if (query.isPending) {
    return (
      <View style={styles.stateWrap}>
        <ActivityIndicator />
        <Text style={styles.stateLabel}>Loading your cookbook...</Text>
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={styles.stateWrap}>
        <Text style={styles.errorTitle}>Could not load cookbook</Text>
        <Text style={styles.stateLabel}>Please pull to refresh or try again shortly.</Text>
      </View>
    );
  }

  if (!query.data || query.data.items.length === 0) {
    return (
      <View style={styles.stateWrap}>
        <Text style={styles.emptyTitle}>Your cookbook is empty</Text>
        <Text style={styles.stateLabel}>Generate and save recipes to start auto-organizing by category.</Text>
      </View>
    );
  }

  return (
    <>
      <SectionList
        style={styles.list}
        sections={sections}
        keyExtractor={(item) => item.id}
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Image
              source={item.image_url ?? "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1400&q=80"}
              style={styles.cardImage}
              contentFit="cover"
            />
            <LinearGradient colors={["transparent", "rgba(15,23,42,0.8)"]} style={styles.cardGradient} />
            <BlurView intensity={18} tint="dark" style={styles.cardGlass}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardSummary}>{item.summary}</Text>
              <Pressable
                style={styles.overrideButton}
                onPress={() => {
                  setSelectedRecipeId(item.id);
                  setOverrideCategory("");
                }}
              >
                <Text style={styles.overrideButtonText}>Override category</Text>
              </Pressable>
            </BlurView>
          </View>
        )}
        contentContainerStyle={styles.contentContainer}
      />

      <Modal
        transparent
        visible={selectedRecipeId !== null}
        animationType="fade"
        onRequestClose={() => setSelectedRecipeId(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedRecipeId(null)}>
          <Pressable style={styles.modalCard}>
            <Text style={styles.modalTitle}>Set category override</Text>
            <TextInput
              value={overrideCategory}
              onChangeText={setOverrideCategory}
              placeholder="Example: Date Night Classics"
              style={styles.modalInput}
            />
            <Pressable
              style={styles.modalSaveButton}
              onPress={() => {
                if (!selectedRecipeId || !overrideCategory.trim()) {
                  return;
                }
                overrideMutation.mutate({ recipeId: selectedRecipeId, category: overrideCategory.trim() });
              }}
            >
              <Text style={styles.modalSaveButtonText}>
                {overrideMutation.isPending ? "Saving..." : "Save override"}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: "#F8FAFC" },
  contentContainer: { padding: 16, paddingBottom: 22, gap: 10 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#0F172A", marginBottom: 8, marginTop: 12 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.25)",
    marginBottom: 10,
    overflow: "hidden",
    height: 220,
    justifyContent: "flex-end"
  },
  cardImage: { ...StyleSheet.absoluteFillObject },
  cardGradient: { ...StyleSheet.absoluteFillObject },
  cardGlass: {
    margin: 12,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    padding: 12,
    gap: 6
  },
  overrideButton: {
    marginTop: 4,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "rgba(167,243,208,0.45)",
    backgroundColor: "rgba(236,253,245,0.18)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  overrideButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ECFDF5"
  },
  cardTitle: { fontSize: 20, fontWeight: "700", color: "#FFFFFF", marginBottom: 2 },
  cardSummary: { fontSize: 13, color: "#E2E8F0" },
  stateWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 20 },
  stateLabel: { color: "#475569", textAlign: "center" },
  errorTitle: { color: "#B91C1C", fontWeight: "700", fontSize: 16 },
  emptyTitle: { color: "#0F172A", fontWeight: "700", fontSize: 16 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#D6DDE4",
    padding: 16,
    gap: 10
  },
  modalTitle: { fontSize: 16, fontWeight: "700", color: "#0F172A" },
  modalInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 12
  },
  modalSaveButton: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: "#047857",
    alignItems: "center",
    justifyContent: "center"
  },
  modalSaveButtonText: { color: "#FFFFFF", fontWeight: "700" }
});
