import { Pressable, StyleSheet, Text, View } from "react-native";

export default function SettingsScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.subtitle}>Privacy and memory controls are server actions.</Text>

      <Pressable style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>Reset Memory (server action)</Text>
      </Pressable>

      <Pressable style={styles.dangerButton}>
        <Text style={styles.dangerButtonText}>Delete Account Data (server action)</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    padding: 16,
    gap: 12
  },
  title: { fontSize: 24, fontWeight: "700", color: "#0F172A" },
  subtitle: { color: "#475569", marginBottom: 6 },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF"
  },
  secondaryButtonText: { color: "#0F172A", fontWeight: "700" },
  dangerButton: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#B91C1C"
  },
  dangerButtonText: { color: "#FFFFFF", fontWeight: "700" }
});
