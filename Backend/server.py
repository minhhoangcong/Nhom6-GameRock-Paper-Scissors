import asyncio
import websockets
import json
import random
import uuid
import hashlib
from typing import Dict, List, Set

class GameRoom:
    def __init__(self, room_id: str, room_name: str, max_players: int = 2, password_hash: str | None = None):
        self.room_id = room_id
        self.room_name = room_name
        self.max_players = max_players
        self.round_task = None  # asyncio.Task đếm giờ cho ván hiện tại
        self.players: List[websockets.WebSocketServerProtocol] = []
        self.choices: Dict[websockets.WebSocketServerProtocol, str] = {}
        self.scores: Dict[websockets.WebSocketServerProtocol, dict] = {}
        self.game_state = 'waiting'  # waiting, playing, finished
        self.ready_players: Set[websockets.WebSocketServerProtocol] = set()
        
    def add_player(self, player: websockets.WebSocketServerProtocol, player_name: str):
        if len(self.players) < self.max_players:
            self.players.append(player)
            self.scores[player] = {'wins': 0, 'losses': 0, 'draws': 0, 'name': player_name}
            return True
        return False
    
    def remove_player(self, player: websockets.WebSocketServerProtocol):
        if player in self.players:
            self.players.remove(player)
            if player in self.choices:
                del self.choices[player]
            if player in self.scores:
                del self.scores[player]
            if player in self.ready_players:
                self.ready_players.remove(player)
            return True
        return False
    
    def is_full(self):
        return len(self.players) >= self.max_players
    
    def can_start_game(self):
        return len(self.players) >= 2 and len(self.ready_players) == len(self.players)
    
    def get_room_info(self):
        return {
            'room_id': self.room_id,
            'room_name': self.room_name,
            'max_players': self.max_players,
            'current_players': len(self.players),
            'game_state': self.game_state,
            'players': [{'name': self.scores[p]['name'], 'ready': p in self.ready_players} for p in self.players],
            'scores': {self.scores[p]['name']: {'wins': self.scores[p]['wins'], 'losses': self.scores[p]['losses'], 'draws': self.scores[p]['draws']} for p in self.players},
            'has_password': bool(self.password_hash)
        }

class GameServer:
    def __init__(self):
        self.clients: Dict[websockets.WebSocketServerProtocol, dict] = {}
        self.rooms: Dict[str, GameRoom] = {}
        self.player_counter = 0
        
    def get_next_player_id(self) -> int:
        self.player_counter += 1
        return self.player_counter
    
    def create_room(self, room_name: str, max_players: int = 2, password_hash: str | None = None) -> str:
        room_id = str(uuid.uuid4())[:8]
        self.rooms[room_id] = GameRoom(room_id, room_name, 2, password_hash=password_hash)
        return room_id
    def _hash_password(self, s: str) -> str:
        return hashlib.sha256(s.encode('utf-8')).hexdigest()
    
    def get_room(self, room_id: str) -> GameRoom:
        return self.rooms.get(room_id)
    
    def get_player_room(self, player: websockets.WebSocketServerProtocol) -> str:
        for room_id, room in self.rooms.items():
            if player in room.players:
                return room_id
        return None
    
    def remove_room(self, room_id: str):
        if room_id in self.rooms:
            del self.rooms[room_id]
    
    def get_room_info_with_player_ids(self, room: GameRoom):
        """Lấy thông tin phòng với player_id cho mỗi người chơi"""
        room_info = room.get_room_info()
        # Thêm player_id cho mỗi player
        for player in room_info['players']:
            for websocket, client_info in self.clients.items():
                if websocket in room.players and room.scores[websocket]['name'] == player['name']:
                    player['player_id'] = client_info['id']
                    player['player_name'] = player['name']
                    break
        return room_info
    
    def get_rooms_list(self):
        rooms_info = []
        for room in self.rooms.values():
            room_info = self.get_room_info_with_player_ids(room)
            room_info['is_full'] = room.is_full()
            rooms_info.append(room_info)
        return rooms_info
    
    def compare_choices(self, choices: Dict[str, List[websockets.WebSocketServerProtocol]]
                ) -> Dict[websockets.WebSocketServerProtocol, str]:
        """So sánh lựa chọn và trả kết quả cho từng người chơi.
        - 1 loại => hòa
        - 3 loại => hòa
        - 2 loại => loại thắng theo bảng quy tắc"""
        results = {}

        # Tập các loại được chọn
        kinds = set(choices.keys())
        if len(kinds) == 1 or len(kinds) == 3:
            for players in choices.values():
                for p in players:
                    results[p] = 'draw'
            return results

        # Chỉ còn trường hợp có đúng 2 loại
        beats = {'rock': 'scissors', 'scissors': 'paper', 'paper': 'rock'}
        a, b = list(kinds)
        if beats[a] == b:
            winner, loser = a, b
        elif beats[b] == a:
            winner, loser = b, a
        else:
            # Phòng hờ (không xảy ra) -> hòa
            winner = loser = None

        for ch, players in choices.items():
            for p in players:
                if winner is None:
                    results[p] = 'draw'
                elif ch == winner:
                    results[p] = 'win'
                else:
                    results[p] = 'lose'
        return results
    
    def update_scores(self, room: GameRoom, results: Dict[websockets.WebSocketServerProtocol, str]):
        """Cập nhật điểm số cho tất cả người chơi"""
        for player, result in results.items():
            if result == 'win':
                room.scores[player]['wins'] += 1
            elif result == 'lose':
                room.scores[player]['losses'] += 1
            else:  # draw
                room.scores[player]['draws'] += 1
    def _start_round_timer(self, room: GameRoom, seconds: int = 10):
        """Bắt đầu (hoặc reset) bộ đếm cho ván hiện tại."""
        # Hủy timer cũ nếu có
        if getattr(room, 'round_task', None):
            try:
                room.round_task.cancel()
            except Exception:
                pass
        # Tạo timer mới
        room.round_task = asyncio.create_task(self._round_timeout(room.room_id, seconds))
    def ensure_series_keys(self, room: GameRoom):
        """Đảm bảo mọi người trong phòng đều có key trong series_wins."""
        for p in room.players:
            if p not in room.series_wins:
                room.series_wins[p] = 0

    def reset_series(self, room: GameRoom):
        """Bắt đầu một series mới (reset số ván thắng, bỏ trạng thái kết thúc)."""
        room.series_wins = {}
        for p in room.players:
            room.series_wins[p] = 0
        room.series_over = False

    def series_wins_by_id(self, room: GameRoom):
        """Trả về dict {player_id: wins} để client hiển thị dễ dàng."""
        out = {}
        for p in room.players:
            pid = self.clients[p]['id']
            out[pid] = room.series_wins.get(p, 0)
        return out


    async def _round_timeout(self, room_id: str, seconds: int):
        """Hết giờ: tự chốt lựa chọn cho ai chưa chọn và công bố kết quả."""
        try:
            await asyncio.sleep(seconds)
            room = self.get_room(room_id)
            if not room or room.game_state != 'playing':
                return
            # Gán lựa chọn ngẫu nhiên cho ai chưa chọn
            for p in room.players:
                if p not in room.choices:
                    room.choices[p] = random.choice(['rock', 'paper', 'scissors'])
            # Công bố kết quả
            await self.process_game_result(room_id)
        except asyncio.CancelledError:
            # Timer bị hủy (do mọi người chọn xong sớm hoặc người chơi rời)
            pass


    async def handle_chat(self, websocket, data):
        room_id = self.get_player_room(websocket)
        if not room_id:
            return
        player_name = self.clients[websocket]['name']
        message_text = data.get('message', '')
        if not message_text.strip():
            return  # Không gửi tin nhắn rỗng
        # In ra log server
        print(f"[CHAT] Phòng {room_id} - {player_name}: {message_text}")
        # Gửi lại cho tất cả người chơi trong phòng
        await self.broadcast_to_room(room_id, {
        'type': 'chat',
        'player_name': player_name,
        'message': message_text
    })
    async def handle_client(self, websocket: websockets.WebSocketServerProtocol, path: str):
        """Xử lý kết nối của client"""
        player_id = self.get_next_player_id()
        self.clients[websocket] = {
            'id': player_id,
            'room_id': None,
            'name': f"Player_{player_id}"
        }
        
        # Gửi ID cho client
        await websocket.send(json.dumps({
            'type': 'player_id',
            'player_id': player_id
        }))
        
        try:
            async for message in websocket:
                await self.handle_message(websocket, message)
        except websockets.exceptions.ConnectionClosed:
            print(f"Client {player_id} đã ngắt kết nối")
        finally:
            await self.cleanup_client(websocket)
    
    async def handle_message(self, websocket: websockets.WebSocketServerProtocol, message: str):
        """Xử lý tin nhắn từ client"""
        try:
            data = json.loads(message)
            message_type = data.get('type')
            
            if message_type == 'get_rooms':
                await self.handle_get_rooms(websocket)
            elif message_type == 'create_room':
                await self.handle_create_room(websocket, data)
            elif message_type == 'join_room':
                await self.handle_join_room(websocket, data)
            elif message_type == 'leave_room':
                await self.handle_leave_room(websocket)
            elif message_type == 'ready':
                await self.handle_ready(websocket)
            elif message_type == 'choice':
                await self.handle_choice(websocket, data['choice'])
            elif message_type == 'new_game':
                await self.handle_new_game_request(websocket)
            elif message_type == 'set_name':
                await self.handle_set_name(websocket, data['name'])
            elif message_type == 'chat':
                await self.handle_chat(websocket, data)
            elif message_type == 'ping':
                await websocket.send(json.dumps({'type': 'pong', 't': data.get('t')}))
            else:
                print(f"Tin nhắn không xác định: {message_type}")
                
        except json.JSONDecodeError:
            print(f"Lỗi JSON: {message}")
        except Exception as e:
            print(f"Lỗi xử lý tin nhắn: {e}")
    
    async def handle_get_rooms(self, websocket: websockets.WebSocketServerProtocol):
        """Gửi danh sách phòng"""
        await websocket.send(json.dumps({
            'type': 'rooms_list',
            'rooms': self.get_rooms_list()
        }))
    
    async def handle_create_room(self, websocket: websockets.WebSocketServerProtocol, data: dict):
        """Tạo phòng mới"""
        # Kiểm tra người chơi đã ở trong phòng khác chưa
        current_room_id = self.get_player_room(websocket)
        if current_room_id:
            await websocket.send(json.dumps({
                'type': 'error',
                'message': 'Bạn đã ở trong phòng khác. Hãy rời phòng hiện tại trước.'
            }))
            return
        
        room_name = data.get('room_name', f'Phòng {len(self.rooms) + 1}')
        pwd_plain = (data.get('password') or '').strip()
        pwd_hash = self._hash_password(pwd_plain) if pwd_plain else None

        room_id = self.create_room(room_name, 2, password_hash=pwd_hash)
        room = self.get_room(room_id)
        
        # Thêm người tạo vào phòng
        player_name = self.clients[websocket]['name']
        if room.add_player(websocket, player_name):
            self.clients[websocket]['room_id'] = room_id
            
            # Thông báo cho tất cả client về phòng mới
            await self.broadcast_rooms_update()
            
            # Gửi thông tin phòng cho người tạo
            room_info = self.get_room_info_with_player_ids(room)
            
            await websocket.send(json.dumps({
                'type': 'room_created',
                'room': room_info
            }))
            
            print(f"Tạo phòng {room_id} bởi {player_name}")
        else:
            # Xóa phòng nếu không thể thêm người chơi
            self.remove_room(room_id)
            await websocket.send(json.dumps({
                'type': 'error',
                'message': 'Không thể tạo phòng'
            }))
    
    async def handle_join_room(self, websocket: websockets.WebSocketServerProtocol, data: dict):
        """Tham gia phòng"""
        room_id = data.get('room_id')
        room = self.get_room(room_id)
        
        # Kiểm tra người chơi đã ở trong phòng khác chưa
        current_room_id = self.get_player_room(websocket)
        if current_room_id:
            await websocket.send(json.dumps({
                'type': 'error',
                'message': 'Bạn đã ở trong phòng khác. Hãy rời phòng hiện tại trước.'
            }))
            return
        
        if not room:
            await websocket.send(json.dumps({
                'type': 'error',
                'message': 'Phòng không tồn tại'
            }))
            return
        
        if room.is_full():
            await websocket.send(json.dumps({
                'type': 'error',
                'message': 'Phòng đã đầy (2/2 người chơi)'
            }))
            return
        if getattr(room, 'password_hash', None):
            provided = (data.get('password') or '').strip()
            if not provided:
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': 'Phòng này yêu cầu mật khẩu.'
                }))
                return
            if self._hash_password(provided) != room.password_hash:
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': 'Mật khẩu không đúng.'
                }))
                return
        # Thêm người chơi vào phòng
        player_name = self.clients[websocket]['name']
        if room.add_player(websocket, player_name):
            self.clients[websocket]['room_id'] = room_id
            self.ensure_series_keys(room)  # đảm bảo có key series cho người mới
            # Thông báo cho tất cả trong phòng
            room_info = self.get_room_info_with_player_ids(room)
            
            await self.broadcast_to_room(room_id, {
                'type': 'player_joined',
                'player_name': player_name,
                'room': room_info
            })
            
            # Cập nhật danh sách phòng cho tất cả
            await self.broadcast_rooms_update()
            
            print(f"{player_name} tham gia phòng {room_id}")
        else:
            await websocket.send(json.dumps({
                'type': 'error',
                'message': 'Không thể tham gia phòng'
            }))
    
    async def handle_leave_room(self, websocket: websockets.WebSocketServerProtocol):
        """Rời phòng"""
        room_id = self.get_player_room(websocket)
        if not room_id:
            return
        
        room = self.get_room(room_id)
        player_name = self.clients[websocket]['name']
        
        room.remove_player(websocket)
        self.clients[websocket]['room_id'] = None
        # TODO:
        # Nếu đang trong 1 ván, hủy timer để tránh task “mồ côi”
        if getattr(room, 'round_task', None):
            try:
                room.round_task.cancel()
            except Exception:
                pass
            room.round_task = None

        # Thông báo cho những người còn lại
        room_info = self.get_room_info_with_player_ids(room)
        
        await self.broadcast_to_room(room_id, {
            'type': 'player_left',
            'player_name': player_name,
            'room': room_info
        })
        
        # Cập nhật danh sách phòng cho tất cả
        await self.broadcast_rooms_update()
        
        # Nếu phòng trống, xóa phòng
        if len(room.players) == 0:
            self.remove_room(room_id)
            await self.broadcast_rooms_update()
        
        print(f"{player_name} rời phòng {room_id}")
    
    async def handle_ready(self, websocket):
        """Người chơi sẵn sàng"""
        room_id = self.get_player_room(websocket)
        if not room_id:
            return

        room = self.get_room(room_id)
        room.ready_players.add(websocket)

        # Thông báo ai vừa ready
        room_info = self.get_room_info_with_player_ids(room)
        await self.broadcast_to_room(room_id, {
            'type': 'player_ready',
            'player_name': self.clients[websocket]['name'],
            'room': room_info
        })

        # ✅ Chỉ khi tất cả cùng sẵn sàng mới bắt đầu
        if room.can_start_game():
            if room.series_over:
                self.reset_series(room)

            room.game_state = 'playing'
            is_first_game = all(
                room.scores[p]['wins'] == 0 and
                room.scores[p]['losses'] == 0 and
                room.scores[p]['draws'] == 0
                for p in room.players
            )

            await self.broadcast_to_room(room_id, {
                'type': 'game_start',
                'room': self.get_room_info_with_player_ids(room),
                'is_first_game': is_first_game,
                'both_ready': True,
                'series': {
                    'best_of': room.series_best_of,
                    'wins': self.series_wins_by_id(room),
                    'over': room.series_over,
                    'winner_id': None
                }
            })
            # 🕒 Bắt đầu timer server-side 10s
            self._start_round_timer(room, 10)

    
    async def handle_choice(self, websocket: websockets.WebSocketServerProtocol, choice: str):
        """Xử lý lựa chọn của người chơi"""
        room_id = self.get_player_room(websocket)
        if not room_id:
            return
        
        room = self.get_room(room_id)
        if room.game_state != 'playing':
            return
        
        room.choices[websocket] = choice
        player_name = self.clients[websocket]['name']
        
        # Thông báo cho phòng
        await self.broadcast_to_room(room_id, {
            'type': 'player_chose',
            'player_name': player_name
        })
        
        # Kiểm tra nếu tất cả đã chọn
        if len(room.choices) == len(room.players):
            await self.process_game_result(room_id)
    
    async def process_game_result(self, room_id: str):
        """Xử lý kết quả game (cộng điểm + Bo3)"""
        room = self.get_room(room_id)
        if not room:
            return

        # Hủy timer nếu còn chạy
        if getattr(room, 'round_task', None):
            try:
                room.round_task.cancel()
            except Exception:
                pass
            room.round_task = None

        # Nhóm lựa chọn theo loại
        choices_by_type = {}
        for player, choice in room.choices.items():
            if choice not in choices_by_type:
                choices_by_type[choice] = []
            choices_by_type[choice].append(player)

        # So sánh và tính kết quả
        results = self.compare_choices(choices_by_type)

        # Cập nhật điểm số bảng tổng (thắng/thua/hòa)
        self.update_scores(room, results)

        # ---- Bo3: Cộng điểm series cho người THẮNG (không cộng khi hòa) ----
        self.ensure_series_keys(room)
        for p, r in results.items():
            if r == 'win':
                room.series_wins[p] = room.series_wins.get(p, 0) + 1
    
        # Kiểm tra kết thúc series
        target = (room.series_best_of + 1) // 2  # Bo3 -> 2; Bo5 -> 3
        winner_ws = None
        for p, w in room.series_wins.items():
            if w >= target:
                room.series_over = True
                winner_ws = p
                break

        # Payload gửi xuống client (thêm nhánh 'series')
        game_result = {
            'type': 'game_result',
            'choices': {self.clients[p]['name']: c for p, c in room.choices.items()},
            'results': {self.clients[p]['name']: r for p, r in results.items()},
            'scores': {self.clients[p]['name']: {
                'wins': room.scores[p]['wins'], 'losses': room.scores[p]['losses'], 'draws': room.scores[p]['draws']
            } for p in room.players},
            'series': {
                'best_of': room.series_best_of,
                'wins': self.series_wins_by_id(room),             # {player_id: wins}
                'over': room.series_over,
                'winner_id': self.clients[winner_ws]['id'] if winner_ws else None
            }
        }

        await self.broadcast_to_room(room_id, game_result)

        # Cập nhật thông tin phòng (client cần player_id)
        await self.broadcast_to_room(room_id, {
            'type': 'room_updated',
            'room': self.get_room_info_with_player_ids(room)
        })

        # Reset cho vòng tiếp theo (không reset series ở đây!)
        room.choices.clear()
        room.ready_players.clear()
        room.game_state = 'waiting'

        print(f"Kết quả phòng {room_id}: {game_result['results']}")

    
    async def handle_new_game_request(self, websocket):
        """Xử lý yêu cầu chơi lại"""
        room_id = self.get_player_room(websocket)
        if not room_id:
            return
        room = self.get_room(room_id)
        room.ready_players.add(websocket)
    
        # Thông báo người đã bấm Chơi lại
        player_name = self.clients[websocket]['name']
        await self.broadcast_to_room(room_id, {
            'type': 'player_ready_for_new_game',
            'player_name': player_name,
            'room': self.get_room_info_with_player_ids(room)
        })

        # ✅ Khi cả hai đều bấm Chơi lại
        if len(room.ready_players) == len(room.players):
            if room.series_over:
                self.reset_series(room)

            room.game_state = 'playing'
            await self.broadcast_to_room(room_id, {
                'type': 'game_start',
                'room': self.get_room_info_with_player_ids(room),
                'is_first_game': False,
                'both_ready': True,
                'series': {
                    'best_of': room.series_best_of,
                    'wins': self.series_wins_by_id(room),
                    'over': room.series_over,
                    'winner_id': None
                }
            })
            # 🕒 Timer cho ván mới
            self._start_round_timer(room, 10)


    
    async def handle_set_name(self, websocket: websockets.WebSocketServerProtocol, name: str):
        """Đặt tên người chơi"""
        self.clients[websocket]['name'] = name
        
        # Cập nhật tên trong phòng nếu đang ở phòng
        room_id = self.get_player_room(websocket)
        if room_id:
            room = self.get_room(room_id)
            if websocket in room.scores:
                room.scores[websocket]['name'] = name
                await self.broadcast_to_room(room_id, {
                    'type': 'player_renamed',
                    'player_name': name,
                    'room': room.get_room_info()
                })
    
    async def broadcast_to_room(self, room_id: str, message: dict):
        """Gửi tin nhắn cho tất cả trong phòng"""
        room = self.get_room(room_id)
        if room:
            for player in room.players:
                try:
                    await player.send(json.dumps(message))
                except:
                    pass
    
    async def broadcast_rooms_update(self):
        rooms_list = self.get_rooms_list()
        for client in list(self.clients.keys()):
            try:
                await client.send(json.dumps({'type': 'rooms_list', 'rooms': rooms_list}))
            except:
                pass

    
    async def cleanup_client(self, websocket: websockets.WebSocketServerProtocol):
        """Dọn dẹp khi client ngắt kết nối"""
        # Rời phòng nếu đang ở trong phòng
        await self.handle_leave_room(websocket)
        
        # Xóa khỏi danh sách clients
        if websocket in self.clients:
            del self.clients[websocket]

# Khởi tạo server
game_server = GameServer()

async def handler(websocket, path):
    await game_server.handle_client(websocket, path)

async def main():
    host = "localhost" 
    port = 8082
    print("🚀 Server Kéo Búa Bao đang khởi động...")
    print(f"📍 Địa chỉ: ws://{host}:{port}")
    print("⏳ Đang chờ kết nối...")
    print("🎮 Hỗ trợ 2 người chơi/phòng")

    async with websockets.serve(handler, host, port):
        print("👉 Nhấn Ctrl+C để dừng server")
        try:
            await asyncio.Future()  # chạy vô hạn
        except asyncio.CancelledError:
            # Bị hủy khi Ctrl+C / đóng loop -> bỏ qua để thoát êm
            pass
        finally:
            print("🛑 Server đã tắt.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        # Bắt Ctrl+C ở lớp ngoài để không in traceback
        print("\n🛑 Đã dừng server (Ctrl+C).")

