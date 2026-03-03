import type { PropsWithChildren, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle
} from "react-native";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { alchemyColors, alchemyRadius, alchemySpacing, alchemyTypography } from "@/components/alchemy/theme";

// ─── Internal icon: Magnifying glass ──────────────────────────────────────────
function SearchIcon({ color = alchemyColors.grey1, size = 18 }: { color?: string; size?: number }) {
  const strokeWidth = Math.max(1.5, size * 0.1);
  const circleSize = size * 0.64;
  const handleLength = size * 0.32;

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: circleSize,
          height: circleSize,
          borderRadius: circleSize / 2,
          borderWidth: strokeWidth,
          borderColor: color
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          width: strokeWidth + 1,
          height: handleLength,
          backgroundColor: color,
          borderRadius: strokeWidth,
          transform: [{ rotate: "-45deg" }, { translateX: 1 }]
        }}
      />
    </View>
  );
}

// ─── Screen shell ──────────────────────────────────────────────────────────────
export function AlchemyScreen({ children, style }: PropsWithChildren<{ style?: ViewStyle }>): React.JSX.Element {
  return <View style={[styles.screen, style]}>{children}</View>;
}

// ─── Glass card ────────────────────────────────────────────────────────────────
export function AlchemyGlassCard({
  children,
  style,
  intensity = 20
}: PropsWithChildren<{ style?: ViewStyle; intensity?: number }>): React.JSX.Element {
  return (
    <BlurView intensity={intensity} tint="dark" style={[styles.glassCard, style]}>
      {children}
    </BlurView>
  );
}

// ─── Button ────────────────────────────────────────────────────────────────────
export function AlchemyButton(props: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}): React.JSX.Element {
  const variant = props.variant ?? "primary";
  const disabled = props.disabled || props.loading;

  return (
    <Pressable
      onPress={props.onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.buttonBase,
        variant === "primary" ? styles.buttonPrimary : styles.buttonSecondary,
        disabled ? styles.buttonDisabled : undefined,
        pressed && !disabled ? styles.buttonPressed : undefined
      ]}
    >
      {props.loading ? (
        <ActivityIndicator color={variant === "primary" ? alchemyColors.dark : alchemyColors.grey4} />
      ) : (
        <Text style={[styles.buttonLabel, variant === "primary" ? styles.buttonLabelPrimary : styles.buttonLabelSecondary]}>
          {props.label}
        </Text>
      )}
    </Pressable>
  );
}

// ─── Text input field ──────────────────────────────────────────────────────────
// label is accepted but not rendered above — use `placeholder` for in-field hint.
export function AlchemyField({
  label: _label,
  error,
  multiline,
  right,
  ...inputProps
}: TextInputProps & {
  label?: string;
  error?: string | null;
  right?: ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.fieldWrap}>
      <View style={[styles.inputWrap, multiline ? styles.inputWrapMultiline : undefined]}>
        <TextInput
          {...inputProps}
          multiline={multiline}
          placeholderTextColor={alchemyColors.grey1}
          style={[styles.input, multiline ? styles.inputMultiline : undefined, inputProps.style]}
        />
        {right}
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

// ─── Search input ──────────────────────────────────────────────────────────────
export function AlchemySearchInput({
  style,
  placeholder = "Search",
  ...rest
}: TextInputProps & { style?: ViewStyle }): React.JSX.Element {
  return (
    <View style={[styles.searchWrap, style]}>
      <SearchIcon color={alchemyColors.grey1} size={18} />
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={alchemyColors.grey1}
        style={styles.searchInput}
        {...rest}
      />
    </View>
  );
}

// ─── Filter chip ───────────────────────────────────────────────────────────────
export function AlchemyFilterChip({
  label,
  active,
  onPress
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      style={({ pressed }) => [styles.chip, active ? styles.chipActive : styles.chipInactive, pressed && styles.chipPressed]}
    >
      <Text style={[styles.chipLabel, active ? styles.chipLabelActive : styles.chipLabelInactive]}>
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

// ─── Filter chip row ───────────────────────────────────────────────────────────
export function AlchemyFilterRow({
  options,
  selected,
  onSelect,
  style
}: {
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
  style?: ViewStyle;
}): React.JSX.Element {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.filterRow, style]}
    >
      {options.map((opt) => (
        <AlchemyFilterChip key={opt} label={opt} active={selected === opt} onPress={() => onSelect(opt)} />
      ))}
    </ScrollView>
  );
}

// ─── Recipe card ───────────────────────────────────────────────────────────────
export function AlchemyRecipeCard({
  imageUri,
  title,
  subtitle,
  onPress,
  style
}: {
  imageUri?: string | null;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  style?: ViewStyle;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.cardWrap, style, pressed && styles.cardPressed]}
    >
      <Image
        source={imageUri ?? "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=80"}
        contentFit="cover"
        style={StyleSheet.absoluteFillObject}
        transition={300}
      />
      <LinearGradient
        colors={["transparent", "rgba(6,15,26,0.5)", "rgba(6,15,26,0.88)"]}
        locations={[0.38, 0.68, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.cardTextWrap}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.cardSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// ─── Hero background ───────────────────────────────────────────────────────────
export function AlchemyHeroBackground(): React.JSX.Element {
  return (
    <>
      <Image
        source="https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=1800&q=80"
        contentFit="cover"
        transition={250}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        colors={["rgba(2,12,22,0.2)", "rgba(3,12,24,0.55)", "rgba(4,12,24,0.75)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        colors={["rgba(6,13,24,0.22)", "rgba(2,6,23,0.88)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
    </>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Screen
  screen: {
    flex: 1,
    backgroundColor: alchemyColors.deepDark
  },

  // Glass card
  glassCard: {
    borderRadius: alchemyRadius.xl,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    overflow: "hidden"
  },

  // Button
  buttonBase: {
    minHeight: 64,
    borderRadius: alchemyRadius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: alchemySpacing.md
  },
  buttonPrimary: {
    backgroundColor: alchemyColors.grey4
  },
  buttonSecondary: {
    borderWidth: 1.5,
    borderColor: "rgba(98,110,123,0.55)",
    backgroundColor: "rgba(6,15,26,0.3)"
  },
  buttonDisabled: {
    opacity: 0.42
  },
  buttonPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.984 }]
  },
  buttonLabel: {
    ...alchemyTypography.bodyBold
  },
  buttonLabelPrimary: {
    color: alchemyColors.dark
  },
  buttonLabelSecondary: {
    color: alchemyColors.grey4
  },

  // Field
  fieldWrap: {
    gap: 6
  },
  inputWrap: {
    height: 64,
    borderRadius: alchemyRadius.sm,
    borderWidth: 2,
    borderColor: alchemyColors.dark,
    backgroundColor: alchemyColors.deepDark,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: alchemySpacing.md
  },
  inputWrapMultiline: {
    height: undefined,
    minHeight: 120,
    alignItems: "flex-start",
    paddingVertical: 14
  },
  input: {
    flex: 1,
    color: alchemyColors.grey4,
    ...alchemyTypography.bodyLight,
    paddingVertical: 0
  },
  inputMultiline: {
    minHeight: 90,
    textAlignVertical: "top"
  },
  fieldError: {
    color: alchemyColors.danger,
    ...alchemyTypography.micro,
    marginTop: 2
  },

  // Search
  searchWrap: {
    height: 56,
    borderRadius: alchemyRadius.lg,
    backgroundColor: alchemyColors.dark,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: alchemySpacing.md
  },
  searchInput: {
    flex: 1,
    color: alchemyColors.grey4,
    ...alchemyTypography.bodyLight,
    paddingVertical: 0
  },

  // Filter chip
  chip: {
    height: 28,
    paddingHorizontal: 12,
    borderRadius: alchemyRadius.lg,
    alignItems: "center",
    justifyContent: "center"
  },
  chipActive: {
    backgroundColor: alchemyColors.grey4
  },
  chipInactive: {
    backgroundColor: alchemyColors.dark
  },
  chipPressed: {
    opacity: 0.75
  },
  chipLabel: {
    ...alchemyTypography.caption,
    letterSpacing: 0.5
  },
  chipLabelActive: {
    color: alchemyColors.dark
  },
  chipLabelInactive: {
    color: alchemyColors.grey1
  },
  filterRow: {
    gap: 8,
    flexDirection: "row",
    alignItems: "center"
  },

  // Recipe card
  cardWrap: {
    borderRadius: alchemyRadius.lg,
    overflow: "hidden",
    backgroundColor: alchemyColors.dark
  },
  cardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }]
  },
  cardTextWrap: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    gap: 3
  },
  cardTitle: {
    ...alchemyTypography.caption,
    color: alchemyColors.white,
    lineHeight: 18
  },
  cardSubtitle: {
    ...alchemyTypography.micro,
    color: "rgba(255,255,255,0.72)"
  }
});
