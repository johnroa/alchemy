import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth";

export function AccountMenu(): React.JSX.Element {
  const [visible, setVisible] = useState(false);
  const router = useRouter();
  const { user, signOut } = useAuth();
  const displayName = user?.email?.split("@")[0] ?? "Account";

  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setVisible(true)}>
        <Text style={styles.triggerText}>{displayName}</Text>
      </Pressable>

      <Modal animationType="fade" transparent visible={visible} onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.overlay} onPress={() => setVisible(false)}>
          <View style={styles.menu}>
            <Text style={styles.heading}>Account</Text>
            <Pressable
              onPress={() => {
                setVisible(false);
                router.push("/preferences");
              }}
            >
              <Text style={styles.item}>Preferences</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setVisible(false);
                router.push("/settings");
              }}
            >
              <Text style={styles.item}>Settings</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setVisible(false);
                void signOut().finally(() => {
                  router.replace("/sign-in");
                });
              }}
            >
              <Text style={styles.item}>Sign Out</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    borderWidth: 1,
    borderColor: "#D6DDE4",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999
  },
  triggerText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A"
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.35)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 84,
    paddingRight: 16
  },
  menu: {
    width: 220,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#D6DDE4",
    padding: 16,
    gap: 12
  },
  heading: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A"
  },
  item: {
    fontSize: 14,
    color: "#1E293B"
  }
});
