import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { X } from 'lucide-react';

export interface SkillDetailPaneProps {
  skillId: string;
  name: string;
  description: string;
  version: string;
  useCases: string[];
  languages: string[];
  complexity: string;
  trustLevel: string;
  installUrl: string;
  manifestUrl: string;
  isInstalled?: boolean;
  canInstall?: boolean;
  installBlockedReason?: string;
  averageRating?: string;
  averageScore?: number;
  totalRatings?: number;
  onClose: () => void;
  onInstallClick: () => void;
  onRemoveClick: () => void;
}

export function SkillDetailPane({
  skillId,
  name,
  description,
  version,
  useCases,
  languages,
  complexity,
  trustLevel,
  installUrl,
  manifestUrl,
  isInstalled = false,
  canInstall = true,
  installBlockedReason,
  averageRating,
  averageScore,
  totalRatings,
  onClose,
  onInstallClick,
  onRemoveClick,
}: SkillDetailPaneProps) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4">
        <div className="flex-1">
          <CardTitle>{name}</CardTitle>
          <CardDescription className="text-xs text-gray-500 mt-1">
            ID: {skillId} • v{version}
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 w-8 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto space-y-4">
        {/* Description */}
        <div>
          <h4 className="font-semibold text-sm mb-2">About</h4>
          <p className="text-sm text-gray-700">{description}</p>
        </div>

        {/* Key Metadata */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h5 className="font-semibold text-xs text-gray-600 mb-1">Complexity</h5>
            <Badge>{complexity}</Badge>
          </div>
          <div>
            <h5 className="font-semibold text-xs text-gray-600 mb-1">Trust Level</h5>
            <Badge variant="outline">{trustLevel}</Badge>
          </div>
        </div>

        {typeof totalRatings === 'number' && totalRatings > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2">Method Feedback</h4>
            <div className="text-sm text-gray-700">
              Average rating: <span className="font-semibold">{averageRating || 'n/a'}</span>
              {' '}({averageScore?.toFixed(2) || '0.00'}) from {totalRatings} responses
            </div>
          </div>
        )}

        {/* Use Cases */}
        {useCases.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2">Use Cases</h4>
            <div className="flex flex-wrap gap-2">
              {useCases.map((uc) => (
                <Badge key={uc} variant="secondary" className="text-xs">
                  {uc}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Languages */}
        {languages.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2">Languages</h4>
            <div className="flex flex-wrap gap-2">
              {languages.map((lang) => (
                <Badge key={lang} variant="outline" className="text-xs">
                  {lang}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Links */}
        <div className="pt-4 border-t space-y-2">
          <a
            href={installUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline block"
          >
            → View on GitHub/Source
          </a>
          {manifestUrl && (
            <a
              href={manifestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline block"
            >
              → View Manifest
            </a>
          )}
        </div>

        {!isInstalled && !canInstall && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {installBlockedReason || 'Only verified marketplace skills are installable.'}
          </div>
        )}
      </CardContent>

      <div className="border-t p-4 mt-4">
        {isInstalled ? (
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled
            >
              Installed
            </Button>
            <Button
              onClick={onRemoveClick}
              variant="outline"
              size="sm"
              className="w-full border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
            >
              Remove
            </Button>
          </div>
        ) : (
          <Button
            onClick={onInstallClick}
            disabled={!canInstall}
            size="sm"
            className="w-full"
            title={canInstall ? undefined : installBlockedReason || 'Install is blocked for this skill'}
          >
            {canInstall ? 'Install' : 'Verified Only'}
          </Button>
        )}
      </div>
    </Card>
  );
}
