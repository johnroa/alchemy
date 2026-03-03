import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function IntroScreen(props: { subtitle?: string }): React.JSX.Element {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <Image
        source="https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1800&q=80"
        contentFit="cover"
        transition={400}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Gradient — darker at bottom for text legibility */}
      <LinearGradient
        colors={["rgba(0,0,0,0.08)", "rgba(0,0,0,0.38)", "rgba(0,0,0,0.72)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Brand block — lower-left, matching Figma */}
      <View style={[styles.brandBlock, { paddingBottom: insets.bottom + 52 }]}>
        {/* "alchemy" with underline on "al" */}
        <View style={styles.wordmark}>
          <View>
            <Text style={styles.brand}>al</Text>
            <View style={styles.underline} />
          </View>
          <Text style={styles.brand}>chemy</Text>
        </View>
        <Text style={styles.tagline}>COOKING WITH A.I.</Text>
        {props.subtitle != null && (
          <ActivityIndicator color="rgba(255,255,255,0.45)" style={styles.spinner} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#060F1A"
  },
  brandBlock: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 32,
    gap: 10
  },
  wordmark: {
    flexDirection: "row",
    alignItems: "flex-end"
  },
  brand: {
    color: "#FFFFFF",
    fontSize: 52,
    fontWeight: "300",
    letterSpacing: -0.5,
    lineHeight: 60
  },
  underline: {
    height: 2.5,
    backgroundColor: "#FFFFFF",
    marginTop: 2
  },
  tagline: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    fontWeight: "400",
    letterSpacing: 3.5,
    lineHeight: 18
  },
  spinner: {
    alignSelf: "flex-start",
    marginTop: 4
  }
});
