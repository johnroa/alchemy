import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function ExploreScreen(): React.JSX.Element {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: ["recipes", "feed"],
    queryFn: () => api.getExploreFeed(),
    enabled: isAuthenticated
  });

  if (query.isPending) {
    return (
      <View style={styles.stateWrap}>
        <ActivityIndicator />
        <Text style={styles.stateLabel}>Building your personalized explore feed...</Text>
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={styles.stateWrap}>
        <Text style={styles.errorTitle}>Explore feed unavailable</Text>
        <Text style={styles.stateLabel}>Try again in a moment.</Text>
      </View>
    );
  }

  const items = query.data?.items ?? [];

  if (items.length === 0) {
    return (
      <View style={styles.stateWrap}>
        <Text style={styles.emptyTitle}>No recipes to explore yet</Text>
        <Text style={styles.stateLabel}>New public recipes will appear here automatically.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Image
            source={item.image_url ?? "https://images.unsplash.com/photo-1495521821757-a1efb6729352?auto=format&fit=crop&w=1400&q=80"}
            style={styles.image}
            contentFit="cover"
          />
          <LinearGradient colors={["transparent", "rgba(15,23,42,0.78)"]} style={styles.overlayGradient} />
          <BlurView intensity={20} tint="dark" style={styles.cardGlass}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardSummary}>{item.summary}</Text>
          </BlurView>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  contentContainer: { backgroundColor: "#F8FAFC", padding: 16, gap: 14, paddingBottom: 24 },
  card: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.25)",
    backgroundColor: "#FFFFFF",
    height: 240,
    justifyContent: "flex-end"
  },
  image: { width: "100%", height: 240, position: "absolute" },
  overlayGradient: { ...StyleSheet.absoluteFillObject },
  cardGlass: {
    margin: 12,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    padding: 12,
    gap: 4
  },
  cardTitle: { fontSize: 20, fontWeight: "700", color: "#FFFFFF" },
  cardSummary: { fontSize: 13, color: "#E2E8F0" },
  stateWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 20 },
  stateLabel: { color: "#475569", textAlign: "center" },
  errorTitle: { color: "#B91C1C", fontWeight: "700", fontSize: 16 },
  emptyTitle: { color: "#0F172A", fontWeight: "700", fontSize: 16 }
});
