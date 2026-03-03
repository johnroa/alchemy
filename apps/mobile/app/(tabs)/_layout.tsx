import { Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { alchemyColors } from "@/components/alchemy/theme";

// ─── Tab config ────────────────────────────────────────────────────────────────

const TABS = [
  { name: "my-cookbook", emoji: "📖", label: "Cookbook" },
  { name: "generate", emoji: "✦", label: "Generate" }
] as const;

// ─── Custom tab bar ────────────────────────────────────────────────────────────

function AlchemyTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { bottom: insets.bottom + 16 }]}>
      <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFillObject} />
      {TABS.map((tab) => {
        const route = state.routes.find((r) => r.name === tab.name);
        if (!route) return null;
        const focused = state.routes[state.index]?.name === tab.name;

        return (
          <Pressable
            key={tab.name}
            style={styles.tabBtn}
            onPress={() => {
              if (!focused) navigation.navigate(tab.name);
            }}
          >
            {focused && <View style={styles.activePill} />}
            <Text style={[styles.tabEmoji, { opacity: focused ? 1 : 0.45 }]}>
              {tab.emoji}
            </Text>
            <Text style={[styles.tabLabel, { color: focused ? alchemyColors.dark : "rgba(255,255,255,0.55)" }]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Layout ────────────────────────────────────────────────────────────────────

export default function TabsLayout(): React.JSX.Element {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <AlchemyTabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="my-cookbook" />
      <Tabs.Screen name="generate" />
    </Tabs>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 16,
    right: 16,
    height: 64,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.12)",
    flexDirection: "row",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 20
  },
  tabBtn: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2
  },
  activePill: {
    position: "absolute",
    top: 8,
    bottom: 8,
    left: 12,
    right: 12,
    borderRadius: 999,
    backgroundColor: "#EDEDED"
  },
  tabEmoji: {
    fontSize: 18,
    lineHeight: 22
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.06,
    lineHeight: 13
  }
});
