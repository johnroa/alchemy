import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

const normalizeIngredient = (value: unknown, index: number): WorkspaceIngredient | null => {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const name = value.trim();
    if (!name) {
      return null;
    }

    return { name };
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

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

  const name = typeof item.name === "string" && item.name.trim().length > 0 ? item.name.trim() : `ingredient ${index + 1}`;
  const normalized: WorkspaceIngredient = { name };

  if (typeof item.amount === "number" || typeof item.amount === "string") {
    normalized.amount = item.amount;
  }
  if (typeof item.unit === "string" && item.unit.trim().length > 0) {
    normalized.unit = item.unit.trim();
  }
  if (typeof item.quantity === "string" && item.quantity.trim().length > 0) {
    normalized.quantity = item.quantity.trim();
  }
  if (typeof item.quantity === "number") {
    normalized.quantity = String(item.quantity);
  }
  if (typeof item.category === "string" && item.category.trim().length > 0) {
    normalized.category = item.category.trim();
  }
  if (typeof item.preparation === "string" && item.preparation.trim().length > 0) {
    normalized.preparation = item.preparation.trim();
  }
  if (typeof item.notes === "string" && item.notes.trim().length > 0) {
    normalized.notes = item.notes.trim();
  } else if (typeof item.note === "string" && item.note.trim().length > 0) {
    normalized.notes = item.note.trim();
  }

  return normalized;
};

const normalizeStep = (value: unknown, index: number): WorkspaceStep | null => {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const instruction = value.trim();
    if (!instruction) {
      return null;
    }

    return {
      index: index + 1,
      instruction
    };
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

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
  if (!instruction) {
    return null;
  }

  const safeIndex = Number.isFinite(step.index) ? Number(step.index) : index + 1;
  const normalized: WorkspaceStep = {
    index: safeIndex,
    instruction
  };

  if (typeof step.notes === "string" && step.notes.trim().length > 0) {
    normalized.notes = step.notes.trim();
  }

  if (Array.isArray(step.inline_measurements)) {
    normalized.inline_measurements = step.inline_measurements as RecipeStep["inline_measurements"];
  }

  return normalized;
};

const normalizeRecipe = (value: unknown): WorkspaceRecipe | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const data = value as RawRecipe;

  if (typeof data.title !== "string" || !Array.isArray(data.ingredients) || !Array.isArray(data.steps)) {
    return null;
  }

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

  if (typeof data.id === "string") {
    recipe.id = data.id;
  }
  if (typeof data.description === "string") {
    recipe.description = data.description;
  }
  if (typeof data.summary === "string") {
    recipe.summary = data.summary;
  }
  if (typeof data.notes === "string") {
    recipe.notes = data.notes;
  }
  if (typeof data.image_url === "string" || data.image_url === null) {
    recipe.image_url = data.image_url as string | null;
  }
  if (typeof data.image_status === "string") {
    recipe.image_status = data.image_status;
  }
  if (Array.isArray(data.pairings)) {
    recipe.pairings = data.pairings.filter((item): item is string => typeof item === "string");
  }
  if (Array.isArray(data.emoji)) {
    recipe.emoji = data.emoji.filter((item): item is string => typeof item === "string");
  }
  if (data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)) {
    recipe.metadata = data.metadata as RecipeMetadata;
  }
  if (Array.isArray(data.attachments)) {
    recipe.attachments = data.attachments as NonNullable<WorkspaceRecipe["attachments"]>;
  }

  return recipe;
};

const parseAssistantPayload = (content: string): { recipe: WorkspaceRecipe | null; assistantReply: AssistantReply | null } => {
  try {
    const parsed = JSON.parse(content) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const payload = parsed as {
        recipe?: unknown;
        assistant_reply?: unknown;
      };

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

const recipeHeroImageFallback =
  "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=1600&q=80";

export default function GenerateScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ recipeId?: string }>();
  const editingRecipeId = typeof params.recipeId === "string" && params.recipeId.length > 0 ? params.recipeId : null;

  const [draftId, setDraftId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeRecipe, setActiveRecipe] = useState<WorkspaceRecipe | null>(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const insets = useSafeAreaInsets();

  const {
    generateChatMinimized,
    setGenerateChatMinimized,
    measurementMode,
    inlineMeasurements,
    ingredientGrouping,
    stepLayout
  } = useUiStore();

  const existingRecipeQuery = useQuery({
    queryKey: ["recipes", editingRecipeId, "workspace"],
    queryFn: async () => api.getRecipe(editingRecipeId ?? ""),
    enabled: Boolean(editingRecipeId) && !activeRecipe && !draftId,
    staleTime: 30_000
  });

  useEffect(() => {
    if (!existingRecipeQuery.data) {
      return;
    }

    const normalized = normalizeRecipe(existingRecipeQuery.data);
    if (normalized) {
      setActiveRecipe(normalized);
    }
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
        if (updatedRecipe) {
          setActiveRecipe(updatedRecipe);
        }

        const assistantText = result.data.assistant_reply?.text;

        setMessages((current) => [
          ...current,
          { id: `user-${Date.now()}`, role: "user", content: result.input },
          ...(assistantText
            ? ([
                {
                  id: `assistant-${Date.now()}`,
                  role: "assistant" as const,
                  content: assistantText
                }
              ] as Message[])
            : [])
        ]);
        setErrorMessage(null);
        setGenerateChatMinimized(true);
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      }

      const draftData: DraftResponse = result.data;
      if (!draftId) {
        setDraftId(draftData.id);
      }

      const parsedMessages: Message[] = draftData.messages.map((message, index) => {
        if (message.role === "assistant") {
          const parsed = parseAssistantPayload(message.content);
          if (parsed.assistantReply?.text) {
            return {
              id: message.id,
              role: "assistant",
              content: parsed.assistantReply.text
            };
          }

          if (parsed.recipe) {
            return {
              id: message.id,
              role: "assistant",
              content: parsed.recipe.title
            };
          }
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

      setActiveRecipe(directRecipe ?? latestFromMessages ?? activeRecipe);
      setMessages(parsedMessages);
      setErrorMessage(null);
      setGenerateChatMinimized(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Could not generate recipe draft.");
    }
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      if (!draftId) {
        throw new Error("Create a draft first.");
      }

      return api.finalizeDraft(draftId);
    },
    onSuccess: async (data) => {
      const nextRecipe = normalizeRecipe(data.recipe);
      if (nextRecipe) {
        setActiveRecipe(nextRecipe);
      }
      const assistantText = data.assistant_reply?.text;
      if (assistantText) {
        setMessages((current) => [
          ...current,
          {
            id: `assistant-finalize-${Date.now()}`,
            role: "assistant",
            content: assistantText
          }
        ]);
      }
      setGenerateChatMinimized(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Could not finalize recipe.");
    }
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeRecipe?.id) {
        throw new Error("Finalize recipe before saving to cookbook.");
      }

      return api.saveRecipe(activeRecipe.id);
    },
    onSuccess: async () => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Could not save recipe to cookbook.");
    }
  });

  const onSend = (): void => {
    const value = input.trim();
    if (!value) {
      return;
    }

    sendMutation.mutate(value);
    setInput("");
  };

  const recipeTabs = useMemo(() => {
    if (!activeRecipe) {
      return [] as Array<{ key: string; label: string; recipe: WorkspaceRecipe }>;
    }

    const tabs: Array<{ key: string; label: string; recipe: WorkspaceRecipe }> = [
      {
        key: "main",
        label: activeRecipe.title,
        recipe: activeRecipe
      }
    ];

    for (const attachment of activeRecipe.attachments ?? []) {
      if ("recipe" in attachment && attachment.recipe) {
        const nested = normalizeRecipe(attachment.recipe);
        if (!nested) {
          continue;
        }

        const label = "relation_type" in attachment && attachment.relation_type
          ? `${attachment.relation_type}: ${nested.title}`
          : nested.title;

        const key = "attachment_id" in attachment && attachment.attachment_id
          ? attachment.attachment_id
          : `${label}-${tabs.length}`;

        tabs.push({
          key,
          label,
          recipe: nested
        });
      }
    }

    return tabs;
  }, [activeRecipe]);

  useEffect(() => {
    if (selectedTab >= recipeTabs.length && recipeTabs.length > 0) {
      setSelectedTab(0);
    }
  }, [recipeTabs.length, selectedTab]);

  const currentRecipe = recipeTabs[selectedTab]?.recipe ?? activeRecipe;
  const ingredientGroupingView = useMemo(() => {
    const groups: Array<{ label: string; items: WorkspaceIngredient[] }> = [];
    if (!currentRecipe) {
      return { groups, hasExplicitCategory: false };
    }

    const byKey = new Map<string, WorkspaceIngredient[]>();
    let hasExplicitCategory = false;

    for (const ingredient of currentRecipe.ingredients) {
      const rawCategory = ingredient.category?.trim();
      if (rawCategory) {
        hasExplicitCategory = true;
      }
      const category = rawCategory && rawCategory.length > 0 ? rawCategory : "Ingredients";
      const bucket = byKey.get(category) ?? [];
      bucket.push(ingredient);
      byKey.set(category, bucket);
    }

    for (const [label, items] of byKey.entries()) {
      groups.push({ label, items });
    }

    return {
      groups,
      hasExplicitCategory
    };
  }, [currentRecipe]);
  const canRenderCategoryGroups = ingredientGrouping === "category" && ingredientGroupingView.hasExplicitCategory;
  const workspaceImage = currentRecipe?.image_url ?? activeRecipe?.image_url ?? recipeHeroImageFallback;
  const tabBarClearance = 96 + insets.bottom;
  const chatBottomOffset = tabBarClearance;
  const recipeBottomPadding = tabBarClearance + 280;

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: undefined })}
      style={styles.container}
      keyboardVerticalOffset={86}
    >
      <Image source={workspaceImage} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={250} />
      <LinearGradient colors={["rgba(2,6,23,0.55)", "rgba(2,6,23,0.9)"]} style={StyleSheet.absoluteFillObject} />

      <View style={styles.heroBar}>
        <Text style={styles.heroTitle}>What do you want to make today?</Text>
        <Text style={styles.heroSubtitle}>Recipe-first workspace with adaptive chef chat.</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.recipeScroll, { paddingBottom: recipeBottomPadding }]}>
        {sendMutation.isPending && !activeRecipe ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color="#FFFFFF" />
            <Text style={styles.stateLabel}>Composing your recipe...</Text>
          </View>
        ) : errorMessage && !activeRecipe ? (
          <View style={styles.stateCard}>
            <Text style={styles.errorTitle}>Something went wrong</Text>
            <Text style={styles.stateLabel}>{errorMessage}</Text>
          </View>
        ) : !currentRecipe ? (
          <View style={styles.stateCard}>
            <Text style={styles.emptyTitle}>No recipe yet</Text>
            <Text style={styles.stateLabel}>Start with “chicken parm for a romantic dinner for 2”.</Text>
          </View>
        ) : (
          <>
            <View style={styles.recipeHeaderCard}>
              <Text style={styles.recipeTitle}>{currentRecipe.title}</Text>
              <Text style={styles.recipeMeta}>
                {currentRecipe.servings} servings · {measurementMode.toUpperCase()} · {stepLayout}
              </Text>
              <Text style={styles.recipeDescription}>{currentRecipe.summary ?? currentRecipe.description ?? ""}</Text>
            </View>

            {recipeTabs.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
                {recipeTabs.map((tab, index) => (
                  <Pressable
                    key={tab.key}
                    style={[styles.tabPill, selectedTab === index ? styles.tabPillActive : undefined]}
                    onPress={() => setSelectedTab(index)}
                  >
                    <Text style={[styles.tabPillText, selectedTab === index ? styles.tabPillTextActive : undefined]} numberOfLines={1}>
                      {tab.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>{canRenderCategoryGroups ? "Ingredients (by category)" : "Ingredients"}</Text>
              {canRenderCategoryGroups
                ? ingredientGroupingView.groups.map((group) => (
                    <View key={group.label} style={styles.ingredientGroup}>
                      <Text style={styles.ingredientGroupTitle}>{group.label}</Text>
                      {group.items.map((ingredient, index) => (
                        <Text
                          key={`${group.label}-${ingredient.name}-${index}-${ingredient.quantity ?? ingredient.amount ?? ""}`}
                          style={styles.sectionText}
                        >
                          •{" "}
                          {[
                            ingredient.amount !== undefined ? String(ingredient.amount) : undefined,
                            ingredient.unit,
                            ingredient.amount === undefined ? ingredient.quantity : undefined,
                            ingredient.name
                          ]
                            .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
                            .join(" ")}
                          {ingredient.preparation ? `, ${ingredient.preparation}` : ""}
                          {ingredient.notes ? ` (${ingredient.notes})` : ""}
                        </Text>
                      ))}
                    </View>
                  ))
                : currentRecipe.ingredients.map((ingredient, index) => (
                    <Text
                      key={`${ingredient.name}-${index}-${ingredient.quantity ?? ingredient.amount ?? ""}`}
                      style={styles.sectionText}
                    >
                      •{" "}
                      {[
                        ingredient.amount !== undefined ? String(ingredient.amount) : undefined,
                        ingredient.unit,
                        ingredient.amount === undefined ? ingredient.quantity : undefined,
                        ingredient.name
                      ]
                        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
                        .join(" ")}
                      {ingredient.preparation ? `, ${ingredient.preparation}` : ""}
                      {ingredient.notes ? ` (${ingredient.notes})` : ""}
                    </Text>
                  ))}
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Steps</Text>
              {currentRecipe.steps.map((step, idx) => {
                const safeInstruction = typeof step?.instruction === "string" ? step.instruction : "";
                const safeStepIndex = Number.isFinite(step?.index) ? step.index : idx + 1;
                const safeInlineMeasurements = Array.isArray(step?.inline_measurements) ? step.inline_measurements : [];
                const safeKey = `${safeStepIndex}-${idx}-${safeInstruction.slice(0, 32)}`;

                return (
                <View key={safeKey} style={styles.stepRow}>
                  <Text style={styles.stepIndex}>{safeStepIndex}.</Text>
                  <View style={styles.stepBody}>
                    <Text style={styles.sectionText}>{safeInstruction}</Text>
                    {inlineMeasurements && safeInlineMeasurements.length > 0 ? (
                      <Text style={styles.inlineText}>
                        Inline: {safeInlineMeasurements.map((item) => `${item.amount} ${item.unit} ${item.ingredient}`).join(" · ")}
                      </Text>
                    ) : null}
                    {typeof step?.notes === "string" && step.notes.length > 0 ? <Text style={styles.inlineText}>{step.notes}</Text> : null}
                  </View>
                </View>
              )})}
            </View>

            {currentRecipe.metadata ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Metadata</Text>
                <Text style={styles.sectionText}>{JSON.stringify(currentRecipe.metadata, null, 2)}</Text>
              </View>
            ) : null}

            <View style={styles.actionRow}>
              <Pressable
                style={styles.actionButton}
                onPress={() => {
                  if (!draftId) {
                    return;
                  }
                  finalizeMutation.mutate();
                }}
                disabled={finalizeMutation.isPending || !draftId}
              >
                <Text style={styles.actionButtonText}>
                  {draftId ? (finalizeMutation.isPending ? "Finalizing..." : "Finalize Recipe") : "Direct Edit Mode"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.secondaryActionButton]}
                onPress={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                <Text style={styles.actionButtonText}>{saveMutation.isPending ? "Saving..." : "Add to My Cookbook"}</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      <BlurView
        intensity={28}
        tint="dark"
        style={[styles.chatOverlay, { bottom: chatBottomOffset }, generateChatMinimized ? styles.chatOverlayMin : undefined]}
      >
        <Pressable
          style={styles.overlayHandle}
          onPress={() => setGenerateChatMinimized(!generateChatMinimized)}
        >
          <Text style={styles.overlayHandleText}>{generateChatMinimized ? "Open Chat" : "Minimize Chat"}</Text>
          <Text style={styles.overlaySubtle}>{messages[messages.length - 1]?.content ?? "Ready for your next tweak."}</Text>
        </Pressable>

        {!generateChatMinimized ? (
          <>
            <FlatList
              data={messages}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.messageList}
              renderItem={({ item }) => (
                <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.assistantBubble]}>
                  <Text style={[styles.bubbleText, item.role === "user" ? styles.userText : styles.assistantText]}>{item.content}</Text>
                </View>
              )}
            />
            <View style={styles.inputRow}>
              <TextInput
                placeholder="Ask for tweaks, pairings, or attachments..."
                value={input}
                onChangeText={setInput}
                style={styles.input}
                multiline
                placeholderTextColor="#94A3B8"
              />
              <Pressable style={styles.sendButton} onPress={onSend}>
                <Text style={styles.sendButtonText}>Send</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </BlurView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020617" },
  heroBar: {
    paddingTop: 62,
    paddingHorizontal: 18,
    paddingBottom: 10,
    gap: 4
  },
  heroTitle: { color: "#FFFFFF", fontSize: 28, fontWeight: "700" },
  heroSubtitle: { color: "#CBD5E1", fontSize: 14 },
  recipeScroll: {
    padding: 16,
    gap: 10
  },
  stateCard: {
    minHeight: 220,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "rgba(15,23,42,0.42)",
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  stateLabel: { color: "#CBD5E1", textAlign: "center" },
  errorTitle: { color: "#FCA5A5", fontWeight: "700", fontSize: 18 },
  emptyTitle: { color: "#FFFFFF", fontWeight: "700", fontSize: 18 },
  recipeHeaderCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(15,23,42,0.42)",
    padding: 16,
    gap: 6
  },
  recipeTitle: { color: "#FFFFFF", fontSize: 24, fontWeight: "700" },
  recipeMeta: { color: "#A7F3D0", fontSize: 13, fontWeight: "600" },
  recipeDescription: { color: "#E2E8F0", fontSize: 14, lineHeight: 20 },
  tabRow: { gap: 8, paddingTop: 8, paddingBottom: 2 },
  tabPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(203,213,225,0.36)",
    backgroundColor: "rgba(15,23,42,0.48)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 240
  },
  tabPillActive: {
    borderColor: "rgba(16,185,129,0.65)",
    backgroundColor: "rgba(6,78,59,0.86)"
  },
  tabPillText: { color: "#CBD5E1", fontWeight: "600", fontSize: 12 },
  tabPillTextActive: { color: "#ECFDF5" },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(15,23,42,0.42)",
    padding: 14,
    gap: 8,
    marginTop: 10
  },
  sectionTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  ingredientGroup: { gap: 6, marginBottom: 6 },
  ingredientGroupTitle: { color: "#A7F3D0", fontSize: 13, fontWeight: "700", textTransform: "capitalize" },
  sectionText: { color: "#E2E8F0", fontSize: 14, lineHeight: 20 },
  stepRow: { flexDirection: "row", gap: 8 },
  stepIndex: { color: "#A7F3D0", fontWeight: "700", width: 18 },
  stepBody: { flex: 1, gap: 3 },
  inlineText: { color: "#94A3B8", fontSize: 12 },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  actionButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: "rgba(5,150,105,0.9)",
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryActionButton: {
    backgroundColor: "rgba(15,23,42,0.88)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.45)"
  },
  actionButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13, textAlign: "center" },
  chatOverlay: {
    position: "absolute",
    left: 12,
    right: 12,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.42)",
    maxHeight: 320
  },
  chatOverlayMin: {
    maxHeight: 88
  },
  overlayHandle: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.3)",
    gap: 2
  },
  overlayHandleText: { color: "#ECFDF5", fontWeight: "700" },
  overlaySubtle: { color: "#CBD5E1", fontSize: 12 },
  messageList: { padding: 10, gap: 8, maxHeight: 170 },
  bubble: { borderRadius: 14, padding: 10 },
  userBubble: { alignSelf: "flex-end", backgroundColor: "rgba(5,150,105,0.92)" },
  assistantBubble: { alignSelf: "flex-start", backgroundColor: "rgba(30,41,59,0.92)" },
  bubbleText: { fontSize: 13, lineHeight: 18 },
  userText: { color: "#FFFFFF" },
  assistantText: { color: "#E2E8F0" },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "flex-end", padding: 10 },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 90,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.45)",
    backgroundColor: "rgba(15,23,42,0.65)",
    color: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13
  },
  sendButton: {
    minHeight: 42,
    minWidth: 66,
    borderRadius: 12,
    backgroundColor: "rgba(5,150,105,0.96)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12
  },
  sendButtonText: { color: "#FFFFFF", fontWeight: "700" }
});
