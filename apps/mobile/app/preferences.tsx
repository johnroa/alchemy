import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { api, type PreferenceProfile } from "@/lib/api";

const emptyPreferences: PreferenceProfile = {
  free_form: "",
  dietary_preferences: [],
  dietary_restrictions: [],
  skill_level: "intermediate",
  equipment: [],
  cuisines: [],
  aversions: [],
  cooking_for: "",
  max_difficulty: 3
};

export default function PreferencesScreen(): React.JSX.Element {
  const query = useQuery({ queryKey: ["preferences"], queryFn: () => api.getPreferences() });
  const [form, setForm] = useState<PreferenceProfile>(emptyPreferences);

  useEffect(() => {
    if (query.data) {
      setForm(query.data);
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: async (payload: PreferenceProfile) => api.updatePreferences(payload),
    onSuccess: async (data) => {
      setForm(data);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  });

  if (query.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.subtle}>Loading preference profile...</Text>
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Could not load preferences</Text>
        <Text style={styles.subtle}>Please retry from your profile menu.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Tell Alchemy how you cook</Text>
      <Text style={styles.subtitle}>Free-form + structured preferences power personalization and generation quality.</Text>

      <Field
        label="Free-form"
        placeholder="I cook for two, prefer weeknight recipes under 45 minutes..."
        value={form.free_form ?? ""}
        multiline
        onChangeText={(value) => setForm((prev) => ({ ...prev, free_form: value }))}
      />
      <Field
        label="Equipment"
        placeholder="la cornue stove, cast iron, vitamix"
        value={(form.equipment ?? []).join(", ")}
        onChangeText={(value) => setForm((prev) => ({ ...prev, equipment: splitList(value) }))}
      />
      <Field
        label="Dietary preferences"
        placeholder="high-protein, mediterranean"
        value={(form.dietary_preferences ?? []).join(", ")}
        onChangeText={(value) => setForm((prev) => ({ ...prev, dietary_preferences: splitList(value) }))}
      />
      <Field
        label="Dietary restrictions"
        placeholder="gluten-free, nut-free"
        value={(form.dietary_restrictions ?? []).join(", ")}
        onChangeText={(value) => setForm((prev) => ({ ...prev, dietary_restrictions: splitList(value) }))}
      />
      <Field
        label="Skill level"
        placeholder="beginner | intermediate | advanced"
        value={form.skill_level}
        onChangeText={(value) => setForm((prev) => ({ ...prev, skill_level: value }))}
      />
      <Field
        label="Cuisines"
        placeholder="italian, japanese"
        value={(form.cuisines ?? []).join(", ")}
        onChangeText={(value) => setForm((prev) => ({ ...prev, cuisines: splitList(value) }))}
      />
      <Field
        label="Aversions"
        placeholder="cilantro, anchovy"
        value={(form.aversions ?? []).join(", ")}
        onChangeText={(value) => setForm((prev) => ({ ...prev, aversions: splitList(value) }))}
      />
      <Field
        label="Who you cook for"
        placeholder="my partner and two kids"
        value={form.cooking_for ?? ""}
        onChangeText={(value) => setForm((prev) => ({ ...prev, cooking_for: value }))}
      />
      <Field
        label="Max difficulty (1-5)"
        placeholder="3"
        value={String(form.max_difficulty)}
        onChangeText={(value) => setForm((prev) => ({ ...prev, max_difficulty: normalizeDifficulty(value) }))}
      />

      <Pressable style={styles.saveButton} onPress={() => mutation.mutate(form)}>
        <Text style={styles.saveButtonText}>{mutation.isPending ? "Saving..." : "Save Preferences"}</Text>
      </Pressable>
    </ScrollView>
  );
}

function Field(props: {
  label: string;
  placeholder: string;
  value: string;
  multiline?: boolean;
  onChangeText: (value: string) => void;
}): React.JSX.Element {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        placeholder={props.placeholder}
        value={props.value}
        onChangeText={props.onChangeText}
        multiline={props.multiline}
        style={[styles.input, props.multiline ? styles.multiline : undefined]}
      />
    </View>
  );
}

const splitList = (value: string): string[] =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const normalizeDifficulty = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return 3;
  }

  return Math.max(1, Math.min(5, parsed));
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 16, gap: 12, paddingBottom: 30 },
  title: { fontSize: 24, fontWeight: "700", color: "#0F172A" },
  subtitle: { color: "#475569", marginBottom: 8 },
  fieldWrap: { gap: 6 },
  label: { fontSize: 13, fontWeight: "700", color: "#0F172A" },
  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: "top",
    paddingVertical: 10
  },
  saveButton: {
    marginTop: 8,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: "#047857",
    alignItems: "center",
    justifyContent: "center"
  },
  saveButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 20 },
  subtle: { color: "#475569", textAlign: "center" },
  error: { color: "#B91C1C", fontWeight: "700", fontSize: 16 }
});
