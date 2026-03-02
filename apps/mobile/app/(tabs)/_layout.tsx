import { Tabs } from "expo-router";
import { AccountMenu } from "@/components/account-menu";

export default function TabsLayout(): React.JSX.Element {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#047857",
        tabBarStyle: {
          borderTopColor: "#D6DDE4",
          height: 78,
          paddingTop: 10,
          paddingBottom: 18
        },
        headerRight: () => <AccountMenu />,
        headerRightContainerStyle: { paddingRight: 16 },
        headerTitleStyle: { fontWeight: "700" }
      }}
    >
      <Tabs.Screen name="my-cookbook" options={{ title: "My Cookbook" }} />
      <Tabs.Screen name="generate" options={{ title: "Generate Recipe" }} />
      <Tabs.Screen name="explore" options={{ title: "Explore" }} />
    </Tabs>
  );
}
