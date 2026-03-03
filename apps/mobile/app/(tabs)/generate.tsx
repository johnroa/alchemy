import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  type AssistantReply,
  api,
  type DraftResponse,
  type RecipeAttachment,
  type RecipeMetadata,
  type RecipeStep
} from "@/lib/api";
import { useUiStore } from "@/lib/ui-store";
import { AlchemyButton, AlchemyFilterChip } from "@/components/alchemy/primitives";
import { alchemyColors, alchemyRadius, alchemyTypography } from "@/components/alchemy/theme";

// ─── Types ─────────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type WorkspaceRecipe = {
  id?: string;
  title: string;
  description?: string;
  summary?: string;
  image_url?: string | null;
  image_status?: string;
  servings: number;
  ingredients: WorkspaceIngredient[];
  steps: WorkspaceStep[];
  notes?: string;
  pairings?: string[];
  metadata?: RecipeMetadata;
  emoji?: string[];
  attachments?: Array<
    | RecipeAttachment
    | {
        relation_type?: string;
        title?: string;
        recipe: WorkspaceRecipe;
      }
  >;
};

type WorkspaceIngredient = {
  name: string;
  amount?: number | string;
  unit?: string;
  quantity?: string;
  category?: string;
  preparation?: string;
  notes?: string;
};

type WorkspaceStep = {
  index: number;
  instruction: string;
  notes?: string;
  inline_measurements?: RecipeStep["inline_measurements"];
};

type RawRecipe = {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  summary?: unknown;
  image_url?: unknown;
  image_status?: unknown;
  servings?: unknown;
  ingredients?: unknown;
  steps?: unknown;
  notes?: unknown;
  pairings?: unknown;
  metadata?: unknown;
  emoji?: unknown;
  attachments?: unknown;
};

// ─── Normalizers ───────────────────────────────────────────────────────────────

const normalizeIngredient = (value: unknown, index: number): WorkspaceIngredient | null => {
  if (!value) return null;

  if (typeof value === "string") {
    const name = value.trim();
    return name ? { name } : null;
  }

  if (typeof value !== "object" || Array.isArray(value)) return null;

  const item = value as {
    name?: unknown;
    amount?: unknown;
    unit?: unknown;
    quantity?: unknown;
    category?: unknown;
    preparation?: unknown;
    notes?: unknown;
    note?: unknown;
  };

  const name =
    typeof item.name === "string" && item.name.trim().length > 0 ? item.name.trim() : `ingredient ${index + 1}`;
  const normalized: WorkspaceIngredient = { name };

  if (typeof item.amount === "number" || typeof item.amount === "string") normalized.amount = item.amount;
  if (typeof item.unit === "string" && item.unit.trim()) normalized.unit = item.unit.trim();
  if (typeof item.quantity === "string" && item.quantity.trim()) normalized.quantity = item.quantity.trim();
  if (typeof item.quantity === "number") normalized.quantity = String(item.quantity);
  if (typeof item.category === "string" && item.category.trim()) normalized.category = item.category.trim();
  if (typeof item.preparation === "string" && item.preparation.trim())
    normalized.preparation = item.preparation.trim();
  if (typeof item.notes === "string" && item.notes.trim()) normalized.notes = item.notes.trim();
  else if (typeof item.note === "string" && item.note.trim()) normalized.notes = item.note.trim();

  return normalized;
};

const normalizeStep = (value: unknown, index: number): WorkspaceStep | null => {
  if (!value) return null;

  if (typeof value === "string") {
    const instruction = value.trim();
    return instruction ? { index: index + 1, instruction } : null;
  }

  if (typeof value !== "object" || Array.isArray(value)) return null;

  const step = value as {
    index?: unknown;
    instruction?: unknown;
    text?: unknown;
    step?: unknown;
    description?: unknown;
    notes?: unknown;
    inline_measurements?: unknown;
  };

  const instructionCandidate =
    typeof step.instruction === "string"
      ? step.instruction
      : typeof step.text === "string"
        ? step.text
        : typeof step.step === "string"
          ? step.step
          : typeof step.description === "string"
            ? step.description
            : "";
  const instruction = instructionCandidate.trim();
  if (!instruction) return null;

  const safeIndex = Number.isFinite(step.index) ? Number(step.index) : index + 1;
  const normalized: WorkspaceStep = { index: safeIndex, instruction };

  if (typeof step.notes === "string" && step.notes.trim()) normalized.notes = step.notes.trim();
  if (Array.isArray(step.inline_measurements))
    normalized.inline_measurements = step.inline_measurements as RecipeStep["inline_measurements"];

  return normalized;
};

const normalizeRecipe = (value: unknown): WorkspaceRecipe | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const data = value as RawRecipe;
  if (typeof data.title !== "string" || !Array.isArray(data.ingredients) || !Array.isArray(data.steps)) return null;

  const ingredients = data.ingredients
    .map((ingredient, index) => normalizeIngredient(ingredient, index))
    .filter((ingredient): ingredient is WorkspaceIngredient => ingredient !== null);

  const steps = data.steps
    .map((step, index) => normalizeStep(step, index))
    .filter((step): step is WorkspaceStep => step !== null);

  const recipe: WorkspaceRecipe = {
    title: data.title,
    servings: Number.isFinite(Number(data.servings)) ? Number(data.servings) : 0,
    ingredients,
    steps
  };

  if (typeof data.id === "string") recipe.id = data.id;
  if (typeof data.description === "string") recipe.description = data.description;
  if (typeof data.summary === "string") recipe.summary = data.summary;
  if (typeof data.notes === "string") recipe.notes = data.notes;
  if (typeof data.image_url === "string" || data.image_url === null)
    recipe.image_url = data.image_url as string | null;
  if (typeof data.image_status === "string") recipe.image_status = data.image_status;
  if (Array.isArray(data.pairings))
    recipe.pairings = data.pairings.filter((item): item is string => typeof item === "string");
  if (Array.isArray(data.emoji))
    recipe.emoji = data.emoji.filter((item): item is string => typeof item === "string");
  if (data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata))
    recipe.metadata = data.metadata as RecipeMetadata;
  if (Array.isArray(data.attachments))
    recipe.attachments = data.attachments as NonNullable<WorkspaceRecipe["attachments"]>;

  return recipe;
};

const parseAssistantPayload = (
  content: string
): { recipe: WorkspaceRecipe | null; assistantReply: AssistantReply | null } => {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const payload = parsed as { recipe?: unknown; assistant_reply?: unknown };
      const recipe = normalizeRecipe(payload.recipe ?? parsed);
      const replyCandidate = payload.assistant_reply;
      const assistantReply =
        typeof replyCandidate === "string" && replyCandidate.trim().length > 0
          ? ({ text: replyCandidate.trim() } as AssistantReply)
          : replyCandidate &&
              typeof replyCandidate === "object" &&
              !Array.isArray(replyCandidate) &&
              typeof (replyCandidate as { text?: unknown }).text === "string"
            ? (replyCandidate as AssistantReply)
            : null;
      return { recipe, assistantReply };
    }
  } catch {
    // no-op
  }
  return { recipe: null, assistantReply: null };
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

const HERO_FALLBACK =
  "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=1600&q=80";

const PANEL_MIN = 62;

const formatMeasure = (ing: WorkspaceIngredient): string => {
  const parts: string[] = [];
  if (ing.amount !== undefined) parts.push(String(ing.amount));
  if (ing.unit) parts.push(ing.unit);
  else if (ing.amount === undefined && ing.quantity) parts.push(ing.quantity);
  return parts.join(" ");
};

const formatIngredientName = (ing: WorkspaceIngredient): string => {
  return ing.preparation ? `${ing.name}, ${ing.preparation}` : ing.name;
};

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function GenerateScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ recipeId?: string }>();
  const editingRecipeId =
    typeof params.recipeId === "string" && params.recipeId.length > 0 ? params.recipeId : null;

  const [draftId, setDraftId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeRecipe, setActiveRecipe] = useState<WorkspaceRecipe | null>(null);
  const [suggestedActions, setSuggestedActions] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState(0);

  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const panelExpandedH = Math.floor(screenHeight * 0.56);

  const {
    generateChatMinimized,
    setGenerateChatMinimized,
    measurementMode,
    inlineMeasurements,
    ingredientGrouping,
    stepLayout
  } = useUiStore();

  // Animated panel height
  const panelAnim = useRef(
    new Animated.Value(generateChatMinimized ? PANEL_MIN : panelExpandedH)
  ).current;
  const messagesRef = useRef<FlatList>(null);

  useEffect(() => {
    Animated.spring(panelAnim, {
      toValue: generateChatMinimized ? PANEL_MIN : panelExpandedH,
      useNativeDriver: false,
      damping: 22,
      mass: 0.9,
      stiffness: 200
    }).start();
  }, [generateChatMinimized, panelExpandedH, panelAnim]);

  // Scroll to latest message when panel opens or messages change
  useEffect(() => {
    if (messages.length > 0 && !generateChatMinimized) {
      const timer = setTimeout(() => messagesRef.current?.scrollToEnd({ animated: true }), 120);
      return () => clearTimeout(timer);
    }
  }, [messages.length, generateChatMinimized]);

  // ── Queries & Mutations ────────────────────────────────────────────────────

  const existingRecipeQuery = useQuery({
    queryKey: ["recipes", editingRecipeId, "workspace"],
    queryFn: async () => api.getRecipe(editingRecipeId ?? ""),
    enabled: Boolean(editingRecipeId) && !activeRecipe && !draftId,
    staleTime: 30_000
  });

  useEffect(() => {
    if (!existingRecipeQuery.data) return;
    const normalized = normalizeRecipe(existingRecipeQuery.data);
    if (normalized) setActiveRecipe(normalized);
  }, [existingRecipeQuery.data]);

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      if (!draftId) {
        if (editingRecipeId) {
          const result = await api.tweakRecipe(editingRecipeId, message);
          return { kind: "tweak" as const, data: result, input: message };
        }
        const result = await api.createDraft(message);
        return { kind: "draft" as const, data: result, input: message };
      }
      const result = await api.continueDraft(draftId, message);
      return { kind: "draft" as const, data: result, input: message };
    },
    onSuccess: async (result) => {
      if (result.kind === "tweak") {
        const updatedRecipe = normalizeRecipe(result.data.recipe);
        if (updatedRecipe) setActiveRecipe(updatedRecipe);
        const assistantText = result.data.assistant_reply?.text;
        const nextSuggestions = Array.isArray(result.data.assistant_reply?.suggested_next_actions)
          ? result.data.assistant_reply?.suggested_next_actions.filter(
              (item): item is string => typeof item === "string"
            )
          : [];
        setMessages((current) => [
          ...current,
          { id: `user-${Date.now()}`, role: "user", content: result.input },
          ...(assistantText
            ? ([{ id: `assistant-${Date.now()}`, role: "assistant" as const, content: assistantText }] as Message[])
            : [])
        ]);
        setSuggestedActions(nextSuggestions);
        setErrorMessage(null);
        setGenerateChatMinimized(true);
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      }

      const draftData: DraftResponse = result.data;
      if (!draftId) setDraftId(draftData.id);

      const parsedMessages: Message[] = draftData.messages.map((message, index) => {
        if (message.role === "assistant") {
          const parsed = parseAssistantPayload(message.content);
          if (parsed.assistantReply?.text)
            return { id: message.id, role: "assistant", content: parsed.assistantReply.text };
          if (parsed.recipe) return { id: message.id, role: "assistant", content: parsed.recipe.title };
        }
        return {
          id: message.id || `${message.role}-${index}`,
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content
        };
      });

      const directRecipe = normalizeRecipe(draftData.active_recipe ?? null);
      const latestFromMessages = [...draftData.messages]
        .reverse()
        .map((message) => parseAssistantPayload(message.content).recipe)
        .find((item): item is WorkspaceRecipe => item !== null);
      const nextRecipe = directRecipe ?? latestFromMessages ?? null;

      if (nextRecipe) setActiveRecipe(nextRecipe);
      setMessages(parsedMessages);
      const nextSuggestions = Array.isArray(draftData.assistant_reply?.suggested_next_actions)
        ? draftData.assistant_reply?.suggested_next_actions.filter((item): item is string => typeof item === "string")
        : [];
      setSuggestedActions(nextSuggestions);
      setErrorMessage(null);
      setGenerateChatMinimized(Boolean(nextRecipe));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Could not generate recipe draft.");
    }
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      if (!draftId) throw new Error("Create a draft first.");
      return api.finalizeDraft(draftId);
    },
    onSuccess: async (data) => {
      const nextRecipe = normalizeRecipe(data.recipe);
      if (nextRecipe) setActiveRecipe(nextRecipe);
      const assistantText = data.assistant_reply?.text;
      if (assistantText)
        setMessages((current) => [
          ...current,
          { id: `assistant-finalize-${Date.now()}`, role: "assistant", content: assistantText }
        ]);
      const nextSuggestions = Array.isArray(data.assistant_reply?.suggested_next_actions)
        ? data.assistant_reply?.suggested_next_actions.filter((item): item is string => typeof item === "string")
        : [];
      setSuggestedActions(nextSuggestions);
      setGenerateChatMinimized(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Could not finalize recipe.");
    }
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeRecipe?.id) throw new Error("Finalize recipe before saving to cookbook.");
      return api.saveRecipe(activeRecipe.id);
    },
    onSuccess: async () => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Could not save recipe.");
    }
  });

  // ── Derived state ──────────────────────────────────────────────────────────

  const recipeTabs = useMemo(() => {
    if (!activeRecipe) return [] as Array<{ key: string; label: string; recipe: WorkspaceRecipe }>;
    const tabs: Array<{ key: string; label: string; recipe: WorkspaceRecipe }> = [
      { key: "main", label: activeRecipe.title, recipe: activeRecipe }
    ];
    for (const attachment of activeRecipe.attachments ?? []) {
      if ("recipe" in attachment && attachment.recipe) {
        const nested = normalizeRecipe(attachment.recipe);
        if (!nested) continue;
        const label =
          "relation_type" in attachment && attachment.relation_type
            ? `${attachment.relation_type}: ${nested.title}`
            : nested.title;
        const key =
          "attachment_id" in attachment && attachment.attachment_id
            ? attachment.attachment_id
            : `${label}-${tabs.length}`;
        tabs.push({ key, label, recipe: nested });
      }
    }
    return tabs;
  }, [activeRecipe]);

  useEffect(() => {
    if (selectedTab >= recipeTabs.length && recipeTabs.length > 0) setSelectedTab(0);
  }, [recipeTabs.length, selectedTab]);

  const currentRecipe = recipeTabs[selectedTab]?.recipe ?? activeRecipe;

  const ingredientGroupingView = useMemo(() => {
    const groups: Array<{ label: string; items: WorkspaceIngredient[] }> = [];
    if (!currentRecipe) return { groups, hasExplicitCategory: false };
    const byKey = new Map<string, WorkspaceIngredient[]>();
    let hasExplicitCategory = false;
    for (const ingredient of currentRecipe.ingredients) {
      const rawCategory = ingredient.category?.trim();
      if (rawCategory) hasExplicitCategory = true;
      const category = rawCategory && rawCategory.length > 0 ? rawCategory : "Ingredients";
      const bucket = byKey.get(category) ?? [];
      bucket.push(ingredient);
      byKey.set(category, bucket);
    }
    for (const [label, items] of byKey.entries()) groups.push({ label, items });
    return { groups, hasExplicitCategory };
  }, [currentRecipe]);

  const canRenderCategoryGroups = ingredientGrouping === "category" && ingredientGroupingView.hasExplicitCategory;

  // ── Layout constants ───────────────────────────────────────────────────────

  const tabBarClearance = insets.bottom + 88;
  const bgImage = currentRecipe?.image_url ?? activeRecipe?.image_url ?? HERO_FALLBACK;

  // ── Handlers ───────────────────────────────────────────────────────────────

  const onSend = (): void => {
    const value = input.trim();
    if (!value || sendMutation.isPending) return;
    sendMutation.mutate(value);
    setInput("");
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const lastMessage = messages[messages.length - 1];

  return (
    <View style={styles.root}>
      {/* ── Background: hero image + gradient (only when recipe is loaded) ── */}
      {currentRecipe ? (
        <>
          <Image
            source={bgImage}
            contentFit="cover"
            style={StyleSheet.absoluteFillObject}
            transition={600}
          />
          <LinearGradient
            colors={["rgba(6,15,26,0.38)", "rgba(6,15,26,0.70)", alchemyColors.deepDark]}
            locations={[0, 0.42, 1]}
            style={StyleSheet.absoluteFillObject}
          />
        </>
      ) : null}

      {/* ── Bottom scrim: darkens recipe canvas behind the panel ── */}
      <LinearGradient
        colors={["transparent", "rgba(4,10,20,0.96)"]}
        locations={[0, 1]}
        style={styles.bottomScrim}
        pointerEvents="none"
      />

      {/* ── Recipe canvas (scrollable) ── */}
      <ScrollView
        style={StyleSheet.absoluteFillObject}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 28, paddingBottom: tabBarClearance + PANEL_MIN + 40 }
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Error banner — visible in all states */}
        {errorMessage ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        ) : null}

        {sendMutation.isPending && !activeRecipe ? (
          // Loading state
          <View style={styles.loadingWrap}>
            <ActivityIndicator color="rgba(255,255,255,0.55)" />
            <Text style={styles.loadingText}>Composing your recipe...</Text>
          </View>
        ) : !currentRecipe ? (
          // Empty state
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>Generate Recipe</Text>
            <Text style={styles.emptySubtitle}>
              Tell the chef assistant what you'd like to cook. Start with ideas, then refine.
            </Text>
          </View>
        ) : (
          // Recipe content
          <>
            {/* Updating indicator (tweaking) */}
            {sendMutation.isPending ? (
              <View style={styles.updatingRow}>
                <ActivityIndicator size="small" color={alchemyColors.grey2} />
                <Text style={styles.updatingText}>Updating recipe...</Text>
              </View>
            ) : null}

            {/* Title */}
            <Text style={styles.recipeTitle}>{currentRecipe.title}</Text>

            {/* Description */}
            {(currentRecipe.summary ?? currentRecipe.description) ? (
              <Text style={styles.recipeDescription}>
                {currentRecipe.summary ?? currentRecipe.description}
              </Text>
            ) : null}

            {/* Meta: time + servings */}
            <View style={styles.metaRow}>
              {currentRecipe.servings > 0 ? (
                <Text style={styles.metaItem}>Serves {currentRecipe.servings}</Text>
              ) : null}
              {(measurementMode !== "us" || stepLayout !== "detailed") ? (
                <Text style={styles.metaItem}>{measurementMode.toUpperCase()}</Text>
              ) : null}
            </View>

            {/* Attachment tabs (when multiple recipes) */}
            {recipeTabs.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabRow}
              >
                {recipeTabs.map((tab, index) => (
                  <AlchemyFilterChip
                    key={tab.key}
                    label={tab.label}
                    active={selectedTab === index}
                    onPress={() => setSelectedTab(index)}
                  />
                ))}
              </ScrollView>
            ) : null}

            {/* ── Ingredients ── */}
            <View style={styles.divider} />
            <Text style={styles.sectionHeader}>Ingredients</Text>

            {canRenderCategoryGroups
              ? ingredientGroupingView.groups.map((group) => (
                  <View key={group.label} style={styles.ingredientGroup}>
                    <Text style={styles.ingredientGroupLabel}>{group.label}</Text>
                    {group.items.map((ing, i) => (
                      <View key={`${group.label}-${ing.name}-${i}`} style={styles.ingredientRow}>
                        <Text style={styles.ingredientMeasure}>{formatMeasure(ing)}</Text>
                        <Text style={styles.ingredientName}>{formatIngredientName(ing)}</Text>
                      </View>
                    ))}
                  </View>
                ))
              : currentRecipe.ingredients.map((ing, i) => (
                  <View key={`${ing.name}-${i}-${ing.amount ?? ""}`} style={styles.ingredientRow}>
                    <Text style={styles.ingredientMeasure}>{formatMeasure(ing)}</Text>
                    <Text style={styles.ingredientName}>{formatIngredientName(ing)}</Text>
                  </View>
                ))}

            {/* ── Method ── */}
            <View style={styles.divider} />
            <Text style={styles.sectionHeader}>Method</Text>

            {currentRecipe.steps.map((step, idx) => {
              const instruction = typeof step?.instruction === "string" ? step.instruction : "";
              const stepNum = Number.isFinite(step?.index) ? step.index : idx + 1;
              const safeInline = Array.isArray(step?.inline_measurements) ? step.inline_measurements : [];
              return (
                <View key={`step-${stepNum}-${idx}`} style={styles.stepRow}>
                  <Text style={styles.stepNum}>{stepNum}</Text>
                  <View style={styles.stepBody}>
                    <Text style={styles.stepText}>{instruction}</Text>
                    {inlineMeasurements && safeInline.length > 0 ? (
                      <Text style={styles.stepInline}>
                        {safeInline
                          .map((item) => `${item.amount} ${item.unit} ${item.ingredient}`)
                          .join(" · ")}
                      </Text>
                    ) : null}
                    {typeof step?.notes === "string" && step.notes.length > 0 ? (
                      <Text style={styles.stepInline}>{step.notes}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })}

            {/* ── Actions ── */}
            <View style={styles.actionSection}>
              {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

              {draftId && !activeRecipe?.id ? (
                <AlchemyButton
                  label="Finalize Recipe"
                  onPress={() => finalizeMutation.mutate()}
                  loading={finalizeMutation.isPending}
                  disabled={finalizeMutation.isPending}
                />
              ) : activeRecipe?.id ? (
                <AlchemyButton
                  label="Save to My Cookbook"
                  onPress={() => saveMutation.mutate()}
                  loading={saveMutation.isPending}
                  disabled={saveMutation.isPending}
                />
              ) : null}
            </View>
          </>
        )}
      </ScrollView>

      {/* ── Floating glass chat panel (keyboard-aware) ── */}
      <KeyboardAvoidingView
        style={StyleSheet.absoluteFillObject}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
        pointerEvents="box-none"
      >
        <View style={{ flex: 1 }} pointerEvents="none" />

        <Animated.View
          style={[
            styles.chatPanel,
            { height: panelAnim, marginBottom: tabBarClearance }
          ]}
        >
          {/* Glass background — purely visual, never a layout container */}
          <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFillObject} />

          {generateChatMinimized ? (
            // ── Collapsed pill ──
            <Pressable
              style={styles.pill}
              onPress={() => setGenerateChatMinimized(false)}
            >
              <Text style={styles.pillGlyph}>✦</Text>
              <Text style={styles.pillPreview} numberOfLines={1}>
                {lastMessage?.content ?? "Ask for ideas, pick one to generate..."}
              </Text>
              <Text style={styles.pillChevron}>↑</Text>
            </Pressable>
          ) : (
            // ── Expanded sheet ──
            <View style={styles.sheet}>
              {/* Drag handle + dismiss */}
              <Pressable
                style={styles.handleArea}
                onPress={() => setGenerateChatMinimized(true)}
              >
                <View style={styles.handle} />
              </Pressable>

              {/* Message list */}
              <FlatList
                ref={messagesRef}
                data={messages}
                keyExtractor={(item) => item.id}
                style={styles.messageList}
                contentContainerStyle={styles.messageListPad}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  <Text style={styles.emptyChat}>
                    Start by telling me what you'd like to cook. Ask for ideas, pick one, then ask
                    for tweaks.
                  </Text>
                }
                renderItem={({ item }) => (
                  <View
                    style={[
                      styles.bubble,
                      item.role === "user" ? styles.userBubble : styles.assistantBubble
                    ]}
                  >
                    <Text
                      style={[
                        styles.bubbleText,
                        item.role === "user" ? styles.userBubbleText : styles.assistantBubbleText
                      ]}
                    >
                      {item.content}
                    </Text>
                  </View>
                )}
              />

              {/* Suggested next actions */}
              {suggestedActions.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.suggestionsRow}
                  keyboardShouldPersistTaps="handled"
                >
                  {suggestedActions.map((action, i) => (
                    <AlchemyFilterChip
                      key={`${action}-${i}`}
                      label={action.length > 28 ? `${action.slice(0, 28)}…` : action}
                      active={false}
                      onPress={() => setInput(action)}
                    />
                  ))}
                </ScrollView>
              ) : null}

              {/* Input row */}
              <View style={styles.inputRow}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder="Ask for ideas or tweaks..."
                  placeholderTextColor={alchemyColors.grey1}
                  style={styles.chatInput}
                  multiline
                  maxLength={600}
                  returnKeyType="send"
                  onSubmitEditing={onSend}
                  blurOnSubmit
                />
                <Pressable
                  style={[
                    styles.sendBtn,
                    (!input.trim() || sendMutation.isPending) && styles.sendBtnDisabled
                  ]}
                  onPress={onSend}
                  disabled={!input.trim() || sendMutation.isPending}
                >
                  {sendMutation.isPending ? (
                    <ActivityIndicator color={alchemyColors.dark} size="small" />
                  ) : (
                    <Text style={styles.sendBtnGlyph}>↑</Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: alchemyColors.deepDark
  },
  scrollContent: {
    paddingHorizontal: 20
  },

  // ── Empty / loading states ──
  emptyWrap: {
    paddingTop: 60,
    gap: 14
  },
  emptyTitle: {
    ...alchemyTypography.titleXL,
    color: alchemyColors.white
  },
  emptySubtitle: {
    ...alchemyTypography.bodyLight,
    color: alchemyColors.grey1,
    lineHeight: 26
  },
  loadingWrap: {
    paddingTop: 120,
    alignItems: "center",
    gap: 16
  },
  loadingText: {
    ...alchemyTypography.bodyLight,
    color: alchemyColors.grey1
  },

  // ── Recipe canvas ──
  updatingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    opacity: 0.7
  },
  updatingText: {
    ...alchemyTypography.captionLight,
    color: alchemyColors.grey2
  },
  recipeTitle: {
    ...alchemyTypography.titleXL,
    color: alchemyColors.white,
    marginBottom: 12
  },
  recipeDescription: {
    ...alchemyTypography.bodySmall,
    color: "rgba(255,255,255,0.75)",
    lineHeight: 24,
    marginBottom: 14
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginBottom: 24
  },
  metaItem: {
    ...alchemyTypography.captionLight,
    color: alchemyColors.grey2,
    letterSpacing: 0.3
  },
  tabRow: {
    gap: 8,
    paddingBottom: 20,
    flexDirection: "row",
    alignItems: "center"
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(27,40,55,0.9)",
    marginBottom: 18
  },
  sectionHeader: {
    ...alchemyTypography.caption,
    color: alchemyColors.grey2,
    letterSpacing: 0.8,
    marginBottom: 14
  },
  ingredientGroup: {
    marginBottom: 16
  },
  ingredientGroupLabel: {
    ...alchemyTypography.caption,
    color: alchemyColors.grey2,
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: "capitalize"
  },
  ingredientRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 12,
    marginBottom: 8
  },
  ingredientMeasure: {
    ...alchemyTypography.captionLight,
    color: alchemyColors.grey1,
    width: 64,
    textAlign: "right",
    flexShrink: 0
  },
  ingredientName: {
    ...alchemyTypography.captionLight,
    color: alchemyColors.grey4,
    flex: 1
  },
  stepRow: {
    flexDirection: "row",
    gap: 14,
    marginBottom: 18,
    alignItems: "flex-start"
  },
  stepNum: {
    ...alchemyTypography.caption,
    color: alchemyColors.grey2,
    lineHeight: 21,
    width: 20,
    textAlign: "right",
    paddingTop: 1
  },
  stepBody: {
    flex: 1,
    gap: 5
  },
  stepText: {
    ...alchemyTypography.captionLight,
    color: alchemyColors.grey4,
    lineHeight: 22
  },
  stepInline: {
    ...alchemyTypography.micro,
    color: alchemyColors.grey1
  },
  actionSection: {
    marginTop: 36,
    gap: 12,
    paddingBottom: 8
  },
  errorText: {
    ...alchemyTypography.captionLight,
    color: alchemyColors.danger,
    textAlign: "center"
  },

  // ── Bottom scrim ──
  bottomScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 280,
    pointerEvents: "none"
  },

  // ── Error banner ──
  errorBanner: {
    backgroundColor: "rgba(248,113,113,0.12)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.3)",
    borderRadius: alchemyRadius.sm,
    padding: 12,
    marginBottom: 16
  },
  errorBannerText: {
    ...alchemyTypography.captionLight,
    color: alchemyColors.danger,
    lineHeight: 20
  },

  // ── Chat panel ──
  chatPanel: {
    marginHorizontal: 12,
    borderRadius: alchemyRadius.xl,
    overflow: "hidden",
    backgroundColor: "rgba(8,16,28,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.55,
    shadowRadius: 32,
    elevation: 20
  },
  // ── Pill (collapsed) ──
  pill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    gap: 12
  },
  pillGlyph: {
    fontSize: 16,
    color: alchemyColors.grey2
  },
  pillPreview: {
    flex: 1,
    ...alchemyTypography.bodySmall,
    color: alchemyColors.grey4,
    letterSpacing: -0.1
  },
  pillChevron: {
    fontSize: 18,
    color: alchemyColors.grey2,
    fontWeight: "600"
  },

  // ── Sheet (expanded) ──
  sheet: {
    flex: 1
  },
  handleArea: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 6
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)"
  },
  messageList: {
    flex: 1
  },
  messageListPad: {
    flexGrow: 1,
    justifyContent: "flex-end",
    padding: 14,
    gap: 10
  },
  emptyChat: {
    ...alchemyTypography.bodySmall,
    color: alchemyColors.grey1,
    textAlign: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    lineHeight: 22
  },
  bubble: {
    maxWidth: "82%",
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 14
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: alchemyColors.grey4,
    borderBottomRightRadius: 4
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(27,40,55,0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderBottomLeftRadius: 4
  },
  bubbleText: {
    ...alchemyTypography.bodySmall,
    lineHeight: 20
  },
  userBubbleText: {
    color: alchemyColors.dark
  },
  assistantBubbleText: {
    color: alchemyColors.grey4
  },
  suggestionsRow: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
    flexDirection: "row",
    alignItems: "center"
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 8,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)"
  },
  chatInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    borderRadius: alchemyRadius.lg,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(6,15,26,0.55)",
    color: alchemyColors.grey4,
    ...alchemyTypography.bodySmall,
    paddingHorizontal: 14,
    paddingVertical: 11,
    lineHeight: 20
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: alchemyColors.grey4,
    alignItems: "center",
    justifyContent: "center"
  },
  sendBtnDisabled: {
    opacity: 0.32
  },
  sendBtnGlyph: {
    fontSize: 20,
    fontWeight: "700",
    color: alchemyColors.dark,
    lineHeight: 24
  }
});
