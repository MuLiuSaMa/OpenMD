import { useEffect, useMemo, useRef, useState } from "react";
import { Box, HStack, IconButton, Text } from "@chakra-ui/react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { dirnameOf, renderFull, stripFrontmatter } from "../renderer/pipeline";
import { renderRichBlocks } from "../renderer/richBlocks";
import { splitSlides } from "../renderer/slides";
import { useWorkspace } from "../stores/workspace";

export function PresentationMode({
  content,
  path,
  onExit,
}: {
  content: string;
  path: string;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  const slides = useMemo(
    () => splitSlides(stripFrontmatter(content)).map((slide) => renderFull(slide, dirnameOf(path)).html),
    [content, path],
  );
  const [current, setCurrent] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrent((value) => Math.min(value, Math.max(0, slides.length - 1)));
  }, [slides.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onExit();
      } else if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        setCurrent((value) => Math.min(slides.length - 1, value + 1));
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        setCurrent((value) => Math.max(0, value - 1));
      } else if (event.key === "Home") {
        event.preventDefault();
        setCurrent(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setCurrent(Math.max(0, slides.length - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit, slides.length]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    void renderRichBlocks(stage, dark, {
      root: useWorkspace.getState().root ?? undefined,
      fromPath: path,
    }).catch(() => {});
  }, [current, dark, path, slides]);

  return (
    <Box
      position="fixed"
      inset={0}
      zIndex={200}
      bg="black"
      display="flex"
      alignItems="center"
      justifyContent="center"
      gap={4}
      p={6}
    >
      <IconButton
        aria-label={t("misc.previousSlide")}
        variant="ghost"
        color="white"
        disabled={current === 0}
        onClick={() => setCurrent((value) => Math.max(0, value - 1))}
      >
        <ChevronLeft />
      </IconButton>
      <Box
        ref={stageRef}
        position="relative"
        w="min(100%, calc((100vh - 96px) * 16 / 9))"
        aspectRatio="16 / 9"
        bg="bg"
        color="fg"
        borderRadius="10px"
        boxShadow="xl"
        overflowY="auto"
        p="6% 8%"
      >
        <article
          className="md-body"
          style={{ maxWidth: "100%", margin: 0, padding: 0 }}
          dangerouslySetInnerHTML={{ __html: slides[current] ?? "" }}
        />
        <HStack position="absolute" right={4} bottom={3} gap={2}>
          <Text fontSize="xs" color="fg.muted">
            {slides.length === 0 ? 0 : current + 1} / {slides.length}
          </Text>
        </HStack>
      </Box>
      <IconButton
        aria-label={t("misc.nextSlide")}
        variant="ghost"
        color="white"
        disabled={current >= slides.length - 1}
        onClick={() => setCurrent((value) => Math.min(slides.length - 1, value + 1))}
      >
        <ChevronRight />
      </IconButton>
      <IconButton
        aria-label={t("misc.exitPresentation")}
        variant="ghost"
        color="white"
        position="absolute"
        top={4}
        right={4}
        onClick={onExit}
      >
        <X />
      </IconButton>
    </Box>
  );
}
