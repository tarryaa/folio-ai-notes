import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ImportDialog, {
  type ImportResult,
} from "../src/components/ImportDialog";
import { blocksToText } from "../src/core/import";

const clipboardImage = () =>
  new File(
    [new Uint8Array(readFileSync(resolve("public/icons/icon-192.png")))],
    "clipboard.png",
    { type: "image/png" },
  );

describe("import dialog mixed clipboard content", () => {
  it("preserves simultaneous rich text and image files, including separate originals", async () => {
    const onImport = vi.fn(),
      notify = vi.fn();
    render(
      <ImportDialog
        note={null}
        onClose={() => {}}
        onNotify={notify}
        onImport={onImport}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "回答を取り込む" });
    const html =
      '<h2>回答の見出し</h2><p>画像に添えた日本語です。</p><img src="blob:clipboard-image">';
    fireEvent.paste(
      within(dialog).getByRole("textbox", { name: "取り込む回答" }),
      {
        clipboardData: {
          files: [clipboardImage()],
          getData: (type: string) =>
            type === "text/html"
              ? html
              : type === "text/plain"
                ? "回答の見出し\n画像に添えた日本語です。"
                : "",
        },
      },
    );
    expect(
      (
        within(dialog).getByRole("combobox", {
          name: "取り込み形式",
        }) as HTMLSelectElement
      ).value,
    ).toBe("html");
    fireEvent.click(within(dialog).getByRole("button", { name: "取り込む" }));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const result = onImport.mock.calls[0][0] as ImportResult;
    expect(blocksToText(result.blocks)).toContain("画像に添えた日本語です。");
    expect(
      result.blocks.some(
        (block) =>
          block.type === "image" &&
          block.src?.startsWith("data:image/png;base64,"),
      ),
    ).toBe(true);
    expect(
      result.originals.some(
        (original) => original.kind === "html" && original.content === html,
      ),
    ).toBe(true);
    expect(
      result.originals.some(
        (original) =>
          original.kind === "image" &&
          original.content.startsWith("data:image/png;base64,"),
      ),
    ).toBe(true);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("両方保持しました"),
    );
  });

  it.each([true, false])(
    "keeps text and image files together while respecting plain-text mode (HTML available: %s)",
    async (htmlAvailable) => {
      const onImport = vi.fn();
      render(
        <ImportDialog
          note={null}
          onClose={() => {}}
          onNotify={() => {}}
          onImport={onImport}
        />,
      );
      const dialog = screen.getByRole("dialog", { name: "回答を取り込む" });
      fireEvent.change(
        within(dialog).getByRole("combobox", { name: "取り込み形式" }),
        { target: { value: "text" } },
      );
      const textarea = within(dialog).getByRole("textbox", {
        name: "取り込む回答",
      }) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "前からある内容\n" } });
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      const html = "<p><strong>新しい回答</strong></p>";
      fireEvent.paste(textarea, {
        clipboardData: {
          files: [clipboardImage()],
          getData: (type: string) =>
            type === "text/html" && htmlAvailable
              ? html
              : type === "text/plain"
                ? "新しい回答"
                : "",
        },
      });
      expect(textarea.value).toBe("前からある内容\n新しい回答");
      expect(
        (
          within(dialog).getByRole("combobox", {
            name: "取り込み形式",
          }) as HTMLSelectElement
        ).value,
      ).toBe("text");
      fireEvent.click(within(dialog).getByRole("button", { name: "取り込む" }));
      await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
      const result = onImport.mock.calls[0][0] as ImportResult;
      expect(blocksToText(result.blocks)).toContain(
        "前からある内容\n新しい回答",
      );
      expect(result.blocks.some((block) => block.type === "image")).toBe(true);
      expect(
        result.originals.some((original) => original.kind === "image"),
      ).toBe(true);
    },
  );
});
