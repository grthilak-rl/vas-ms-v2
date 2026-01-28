'use client';

interface StreamCardProps {
  stream: {
    id: string;
    name: string;
    device_name?: string;
    status: string;
    stream_url: string;
  };
}

export default function StreamCard({ stream }: StreamCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'inactive':
        return 'bg-gray-100 text-gray-800';
      case 'error':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{stream.name}</h3>
          {stream.device_name && (
            <p className="text-sm text-gray-500">Device: {stream.device_name}</p>
          )}
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(stream.status)}`}>
          {stream.status}
        </span>
      </div>
      <div className="bg-gray-900 rounded-lg aspect-video flex items-center justify-center mb-4">
        <a href={`/streams/${stream.id}`} className="w-full h-full flex items-center justify-center hover:bg-gray-800 transition-colors">
          <div className="text-center">
            <svg className="w-16 h-16 mx-auto text-white mb-2" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
            <p className="text-white text-sm">Click to view live stream</p>
          </div>
        </a>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-500 truncate">{stream.stream_url}</span>
        <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          View Stream
        </button>
      </div>
    </div>
  );
}

