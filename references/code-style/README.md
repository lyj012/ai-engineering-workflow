# Code-style references (规范接入位)

This directory is the **injection point** for code-style specifications used by the delivery pipeline
(project-code-style detection, the code-quality checks, and the style review lenses). See the design doc
`代码规范与质量检查能力-分析与设计.md`.

## Precedence (规范优先级)

When deciding what "correct style" means, the pipeline follows this order, highest first:

```
1. 客户项目已有明确规范   (the target project's own explicit conventions/config)
2. 项目现有代码风格       (the prevailing style observed in the target's real code)
3. 阿里巴巴 Java 开发规范  (Alibaba Java guidelines — ONLY IF actually provided here, see below)
4. 通用 Java / 语言最佳实践 (generic best practices — fallback)
```

The pipeline must never refactor the customer's existing code broadly just to satisfy a lower-precedence
rule. New code follows the highest-precedence source available; conflicts are recorded, not "fixed" by
mass rewrites.

## How to provide a spec (后续接入方式)

A spec is "provided" only when this directory contains real specification text (not just a placeholder
README). You may add it in any of these ways:

- drop the spec text into a subdirectory here (e.g. `references/code-style/alibaba-java/`);
- point the pipeline at an external spec file via args;
- expose it through a Skill.

## Honesty rule (绝不假装已加载)

If no real spec text is present (only placeholder READMEs), the pipeline MUST treat that spec as
**not loaded**: it records "spec not provided (placeholder)" in its artifacts and falls back to generic
best practices for that tier. It must never claim it checked against a spec whose content was never supplied.
