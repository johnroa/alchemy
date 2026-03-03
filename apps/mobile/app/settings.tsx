import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query-client";

export default function SettingsScreen(): React.JSX.Element {
  const memoriesQuery = useQuery({
    queryKey: ["memories"],
    queryFn: () => api.getMemories()
  });

  const changelogQuery = useQuery({
    queryKey: ["changelog"],
    queryFn: () => api.getChangelog()
  });

  const resetMemoryMutation = useMutation({
    mutationFn: () => api.resetMemories(),
    onSuccess: async () => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memories"] }),
        queryClient.invalidateQueries({ queryKey: ["changelog"] })
      ]);
    }
  });

  const loading = memoriesQuery.isPending || changelogQuery.isPending;
  const isError = memoriesQuery.isError || changelogQuery.isError;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.subtitle}>Memory controls and user-scoped changelog history.</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Memory</Text>
        {loading ? (
          <View style={styles.inlineState}>
            <ActivityIndicator />
            <Text style={styles.subtle}>Loading memory state...</Text>
          </View>
        ) : isError ? (
          <Text style={styles.errorText}>Could not load memory data.</Text>
        ) : (
          <>
            <Text style={styles.subtle}>
              Active memories: {memoriesQuery.data?.items.length ?? 0} · Snapshot keys:{" "}
              {Object.keys(memoriesQuery.data?.snapshot ?? {}).length}
            </Text>
            <Pressable
              style={styles.dangerButton}
              onPress={() => resetMemoryMutation.mutate()}
              disabled={resetMemoryMutation.isPending}
            >
              <Text style={styles.dangerButtonText}>
                {resetMemoryMutation.isPending ? "Resetting..." : "Reset Memory"}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Recent Changes</Text>
        {loading ? (
          <View style={styles.inlineState}>
            <ActivityIndicator />
            <Text style={styles.subtle}>Loading changelog...</Text>
          </View>
        ) : isError ? (
          <Text style={styles.errorText}>Could not load changelog.</Text>
        ) : (changelogQuery.data?.items.length ?? 0) === 0 ? (
          <Text style={styles.subtle}>No changelog events yet.</Text>
        ) : (
          (changelogQuery.data?.items ?? []).slice(0, 12).map((item) => (
            <View key={item.id} style={styles.eventRow}>
              <Text style={styles.eventAction}>
                {item.scope}.{item.action}
              </Text>
              <Text style={styles.eventTime}>{new Date(item.created_at).toLocaleString()}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC"
  },
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 28
  },
  title: { fontSize: 24, fontWeight: "700", color: "#0F172A" },
  subtitle: { color: "#475569", marginBottom: 6 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
    padding: 12,
    gap: 10
  },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#0F172A" },
  subtle: { color: "#475569" },
  inlineState: { flexDirection: "row", alignItems: "center", gap: 8 },
  dangerButton: {
    marginTop: 6,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#B91C1C"
  },
  dangerButtonText: { color: "#FFFFFF", fontWeight: "700" },
  errorText: {
    color: "#B91C1C",
    fontWeight: "600"
  },
  eventRow: {
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    paddingTop: 8,
    gap: 2
  },
  eventAction: { fontWeight: "600", color: "#0F172A" },
  eventTime: { color: "#64748B", fontSize: 12 }
});
