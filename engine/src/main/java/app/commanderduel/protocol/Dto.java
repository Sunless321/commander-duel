package app.commanderduel.protocol;

import java.util.List;
import java.util.Map;

/** Wire-format snapshot types. Ids are strings: players "p<n>", cards "c<n>", stack items "s<n>". */
public final class Dto {
    private Dto() {}

    public record GameState(
            int turn,
            String phase,
            String activePlayerId,
            String priorityPlayerId,
            String youId,
            List<PlayerDto> players,
            Map<String, CardDto> cards,
            List<StackItemDto> stack,
            List<AttackDto> combat) {}

    public record PlayerDto(
            String id,
            String name,
            boolean you,
            int life,
            int poison,
            Map<String, Integer> commanderDamage,
            Map<String, Integer> manaPool,
            List<String> hand,
            int handCount,
            int libraryCount,
            List<String> graveyard,
            List<String> exile,
            List<String> command,
            List<String> battlefield) {}

    public record CardDto(
            String id,
            String name,
            String ownerId,
            String controllerId,
            String zone,
            boolean tapped,
            boolean sick,
            boolean hidden,
            String imageUrl,
            String manaCost,
            String typeLine,
            String text,
            String power,
            String toughness,
            int damage,
            Map<String, Integer> counters,
            String attachedToId,
            boolean commander) {}

    public record StackItemDto(
            String id, String text, String sourceCardId, String activatorId, List<String> targetIds) {}

    public record AttackDto(String attackerId, String defenderId, List<String> blockerIds) {}
}
