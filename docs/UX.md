# UX Principles v0.1

## POS design goal

A temporary bartender should be able to learn the core checkout path in minutes. The interface is designed for noise, queues, low attention and rapid repetition.

## Bartender principles

- Large touch targets.
- Favourites/top sellers first.
- Categories as secondary navigation.
- Avoid keyboard entry in normal checkout.
- Always display current order and total.
- One obvious primary action at each stage.
- Strong visual distinction between `PENDING`, `PAID`, `FAILED`, `UNKNOWN`.
- No cloud-loading spinners on item selection/order creation.
- Repeat-last-order shortcut.
- Fast quantity controls.
- Accidental destructive actions require guardrails, not routine actions.

## Stock awareness on POS

Product availability can show:
- available;
- low;
- sold out.

Exact inventory quantity should be permission/configuration dependent; bartender UI should not become a stock dashboard.

## Supervisor experience

Supervisor can:
- approve void/comp/refund;
- view bar health;
- see low-stock alerts for own location;
- acknowledge incoming transfer;
- reassign register/device where permitted.

## Inventory experience

Mobile-first workflow for people walking around an event:
- alerts sorted by urgency/time-to-stockout;
- one-tap acknowledge;
- suggested source and quantity;
- assign runner;
- scan/select dispatch;
- confirm receipt;
- see transfer ETA/status.

## Event Control

Prioritize exceptions over vanity metrics. The first screen should answer:
1. Are we selling?
2. Where are queues/throughput deteriorating?
3. Which products/bars will run out?
4. Are payments healthy?
5. Are devices/sync healthy?
6. What requires human action now?
