export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type GenericRelationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          user_id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
          bio: string | null;
          role: "member" | "moderator" | "admin";
          status: "active" | "suspended" | "banned";
          ban_reason: string | null;
          banned_at: string | null;
          suspended_until: string | null;
          birthday: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          username: string;
          display_name: string;
          avatar_url?: string | null;
          bio?: string | null;
          role?: "member" | "moderator" | "admin";
          status?: "active" | "suspended" | "banned";
          ban_reason?: string | null;
          banned_at?: string | null;
          suspended_until?: string | null;
          birthday?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          username?: string;
          display_name?: string;
          avatar_url?: string | null;
          bio?: string | null;
          role?: "member" | "moderator" | "admin";
          status?: "active" | "suspended" | "banned";
          ban_reason?: string | null;
          banned_at?: string | null;
          suspended_until?: string | null;
          birthday?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      arcs: {
        Row: {
          id: string;
          slug: string;
          title: string;
          description: string | null;
          image_url: string | null;
          start_episode: number;
          end_episode: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          title: string;
          description?: string | null;
          image_url?: string | null;
          start_episode: number;
          end_episode: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          title?: string;
          description?: string | null;
          image_url?: string | null;
          start_episode?: number;
          end_episode?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      content_entries: {
        Row: {
          id: string;
          slug: string;
          title: string;
          type: "episode" | "movie" | "special" | "ova" | "live_action" | "magic_kaito" | "hanzawa" | "zero_tea_time" | "yaiba";
          episode_number: number | null;
          movie_number: number | null;
          air_date: string;
          canon_order: number;
          release_order: number | null;
          arc_id: string | null;
          synopsis: string | null;
          image_url: string | null;
          runtime_minutes: number | null;
          crime_types: string[];
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          title: string;
          type: "episode" | "movie" | "special" | "ova" | "live_action" | "magic_kaito" | "hanzawa" | "zero_tea_time" | "yaiba";
          episode_number?: number | null;
          movie_number?: number | null;
          air_date: string;
          canon_order: number;
          release_order?: number | null;
          arc_id?: string | null;
          synopsis?: string | null;
          image_url?: string | null;
          runtime_minutes?: number | null;
          crime_types?: string[] | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          title?: string;
          type?: "episode" | "movie" | "special" | "ova" | "live_action" | "magic_kaito" | "hanzawa" | "zero_tea_time" | "yaiba";
          episode_number?: number | null;
          movie_number?: number | null;
          air_date?: string;
          canon_order?: number;
          release_order?: number | null;
          arc_id?: string | null;
          synopsis?: string | null;
          image_url?: string | null;
          runtime_minutes?: number | null;
          crime_types?: string[] | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_entries_arc_id_fkey";
            columns: ["arc_id"];
            isOneToOne: false;
            referencedRelation: "arcs";
            referencedColumns: ["id"];
          }
        ];
      };
      watch_status: {
        Row: {
          id: string;
          user_id: string;
          content_id: string;
          status: "unwatched" | "watched" | "rewatched";
          watch_count: number;
          favorite: boolean;
          rating: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          content_id: string;
          status?: "unwatched" | "watched" | "rewatched";
          watch_count?: number;
          favorite?: boolean;
          rating?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          content_id?: string;
          status?: "unwatched" | "watched" | "rewatched";
          watch_count?: number;
          favorite?: boolean;
          rating?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "watch_status_content_id_fkey";
            columns: ["content_id"];
            isOneToOne: false;
            referencedRelation: "content_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "watch_status_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          }
        ];
      };
      chat_rooms: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      chat_messages: {
        Row: {
          id: string;
          room_id: string;
          user_id: string;
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          user_id: string;
          content: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          user_id?: string;
          content?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_messages_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "chat_rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chat_messages_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          }
        ];
      };
      badges: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          icon_url: string | null;
          category: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          description?: string | null;
          icon_url?: string | null;
          category?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          description?: string | null;
          icon_url?: string | null;
          category?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      user_badges: {
        Row: {
          id: string;
          user_id: string;
          badge_id: string;
          earned_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          badge_id: string;
          earned_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          badge_id?: string;
          earned_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_badges_badge_id_fkey";
            columns: ["badge_id"];
            isOneToOne: false;
            referencedRelation: "badges";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_badges_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          }
        ];
      };
      screening_events: {
        Row: {
          id: string;
          movie_number: number;
          movie_title: string;
          event_name: string;
          venue: string | null;
          city: string | null;
          date: string | null;
          ticket_url: string | null;
          is_featured: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          movie_number: number;
          movie_title: string;
          event_name: string;
          venue?: string | null;
          city?: string | null;
          date?: string | null;
          ticket_url?: string | null;
          is_featured?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          movie_number?: number;
          movie_title?: string;
          event_name?: string;
          venue?: string | null;
          city?: string | null;
          date?: string | null;
          ticket_url?: string | null;
          is_featured?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      social_links: {
        Row: {
          id: string;
          platform: string;
          handle: string;
          url: string;
          icon: string | null;
          is_active: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          platform: string;
          handle: string;
          url: string;
          icon?: string | null;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          platform?: string;
          handle?: string;
          url?: string;
          icon?: string | null;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      episode_comments: {
        Row: {
          id: string;
          content_id: string;
          user_id: string;
          body: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          content_id: string;
          user_id: string;
          body: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          content_id?: string;
          user_id?: string;
          body?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sync_staging: {
        Row: {
          id: string;
          source: string;
          slug: string;
          title: string;
          type: "episode" | "movie" | "special" | "ova" | "live_action" | "magic_kaito" | "hanzawa" | "zero_tea_time" | "yaiba";
          episode_number: number | null;
          movie_number: number | null;
          air_date: string | null;
          canon_order: number | null;
          synopsis: string | null;
          image_url: string | null;
          runtime_minutes: number | null;
          status: "pending" | "approved" | "rejected";
          review_notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          source: string;
          slug: string;
          title: string;
          type: "episode" | "movie" | "special" | "ova" | "live_action" | "magic_kaito" | "hanzawa" | "zero_tea_time" | "yaiba";
          episode_number?: number | null;
          movie_number?: number | null;
          air_date?: string | null;
          canon_order?: number | null;
          synopsis?: string | null;
          image_url?: string | null;
          runtime_minutes?: number | null;
          status?: "pending" | "approved" | "rejected";
          review_notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          source?: string;
          slug?: string;
          title?: string;
          type?: "episode" | "movie" | "special" | "ova" | "live_action" | "magic_kaito" | "hanzawa" | "zero_tea_time" | "yaiba";
          episode_number?: number | null;
          movie_number?: number | null;
          air_date?: string | null;
          canon_order?: number | null;
          synopsis?: string | null;
          image_url?: string | null;
          runtime_minutes?: number | null;
          status?: "pending" | "approved" | "rejected";
          review_notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          actor_id: string | null;
          type: "comment_reply" | "chat_mention";
          content_id: string | null;
          room_id: string | null;
          message: string;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          actor_id?: string | null;
          type: "comment_reply" | "chat_mention";
          content_id?: string | null;
          room_id?: string | null;
          message: string;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          actor_id?: string | null;
          type?: "comment_reply" | "chat_mention";
          content_id?: string | null;
          room_id?: string | null;
          message?: string;
          is_read?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "notifications_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "notifications_content_id_fkey";
            columns: ["content_id"];
            isOneToOne: false;
            referencedRelation: "content_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "chat_rooms";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: {
      leaderboard: {
        Row: {
          user_id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
          watched_count: number;
          total_minutes: number;
          rank: number;
        };
        Relationships: [];
      };
      public_profiles: {
        Row: {
          user_id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      get_content_rating: {
        Args: { p_content_id: string };
        Returns: { avg_rating: number; rating_count: number };
      };
    };
    Enums: Record<string, never>;
  };
}
