import { Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import { StyleSheet, Text, View } from "react-native";

export default function TabsLayout(): React.JSX.Element {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#ECFDF5",
        tabBarInactiveTintColor: "#94A3B8",
        tabBarStyle: {
          position: "absolute",
          borderTopWidth: 0,
          height: 90,
          paddingTop: 10,
          paddingBottom: 22,
          backgroundColor: "transparent"
        },
        tabBarBackground: () => (
          <View style={styles.tabBarWrap}>
            <BlurView intensity={24} tint="dark" style={styles.tabBarGlass} />
          </View>
        ),
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" }
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          href: null
        }}
      />
      <Tabs.Screen
        name="my-cookbook"
        options={{
          title: "My Cookbook",
          tabBarLabel: "Cookbook",
          tabBarIcon: ({ color }) => <Text style={[styles.icon, { color }]}>📖</Text>
        }}
      />
      <Tabs.Screen
        name="generate"
        options={{
          title: "Generate Recipe",
          tabBarLabel: "Generate",
          tabBarIcon: ({ color }) => <Text style={[styles.icon, { color }]}>✨</Text>
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: "Explore",
          tabBarIcon: ({ color }) => <Text style={[styles.icon, { color }]}>🔎</Text>
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarWrap: {
    flex: 1,
    marginHorizontal: 14,
    marginBottom: 12,
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)"
  },
  tabBarGlass: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.42)"
  },
  icon: {
    fontSize: 15
  }
});
